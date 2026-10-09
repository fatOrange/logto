import { type JsonObject, SocialQrCodeSessions, type SocialQrCodeSession } from '@logto/schemas';
import { type Nullable } from '@silverhand/essentials';
import { type CommonQueryMethods, sql } from '@silverhand/slonik';

import { convertToIdentifiers } from '#src/utils/sql.js';

const { table, fields } = convertToIdentifiers(SocialQrCodeSessions);

/** The queries for browser-bound social QR code sessions. */
type SocialQrCodeSessionQueries = {
  /**
   * Atomically create or replace the QR session of an (interaction, connector) pair: there is
   * always at most one row per pair, and a refresh resets the row (new id/scene, unconfirmed,
   * unconsumed, re-expired) without a stale prior session surviving.
   */
  upsertSession: (data: {
    id: string;
    connectorId: string;
    interactionId: string;
    scene: string;
    expiresAt: number;
  }) => Promise<SocialQrCodeSession>;
  findSessionById: (id: string) => Promise<Nullable<SocialQrCodeSession>>;
  /**
   * Atomically confirm a pending, unexpired session bound to the given connector and scene
   * (first scan wins).
   */
  confirmPendingSessionByConnectorIdAndScene: (
    connectorId: string,
    scene: string,
    userInfo: JsonObject
  ) => Promise<Nullable<SocialQrCodeSession>>;
  /** Atomically consume a confirmed, unexpired session (one-time use). */
  consumeConfirmedSessionById: (
    id: string,
    connectorId: string,
    interactionId: string
  ) => Promise<Nullable<SocialQrCodeSession>>;
  /** Invalidate (cancel) a session owned by the given interaction. Idempotent. */
  deleteSessionByIdAndInteractionId: (id: string, interactionId: string) => Promise<number>;
  /** Deletes all expired sessions; wired into tenant startup for opportunistic cleanup. */
  deleteExpiredSessions: () => Promise<void>;
};

export const createSocialQrCodeSessionQueries = (
  pool: CommonQueryMethods
): SocialQrCodeSessionQueries => {
  /**
   * Narrow SQL upsert instead of the generic insert builder: a refresh must overwrite the row's
   * id/scene/confirmation state atomically (the generic builder has no `on conflict do update`
   * shape that resets confirmation), and the unique (tenant_id, connector_id, interaction_id)
   * constraint keeps exactly one active session per browser+connector.
   */
  const upsertSession = async ({
    id,
    connectorId,
    interactionId,
    scene,
    expiresAt,
  }: {
    id: string;
    connectorId: string;
    interactionId: string;
    scene: string;
    expiresAt: number;
  }) => {
    const {
      rows: [session],
    } = await pool.query<SocialQrCodeSession>(sql`
      insert into ${table} (
        ${fields.id},
        ${fields.connectorId},
        ${fields.interactionId},
        ${fields.scene},
        ${fields.expiresAt}
      )
      values (${id}, ${connectorId}, ${interactionId}, ${scene}, to_timestamp(${expiresAt}::double precision / 1000))
      on conflict (tenant_id, connector_id, interaction_id) do update set
        ${fields.id} = excluded.${fields.id},
        ${fields.scene} = excluded.${fields.scene},
        ${fields.userInfo} = null,
        ${fields.createdAt} = now(),
        ${fields.expiresAt} = excluded.${fields.expiresAt},
        ${fields.consumedAt} = null
      returning ${sql.join(Object.values(fields), sql`, `)}
    `);

    if (!session) {
      throw new Error('Failed to upsert the social QR code session.');
    }

    return session;
  };

  const findSessionById = async (id: string) =>
    pool.maybeOne<SocialQrCodeSession>(sql`
      select ${sql.join(Object.values(fields), sql`, `)}
      from ${table}
      where ${fields.id} = ${id}
    `);

  const confirmPendingSessionByConnectorIdAndScene = async (
    connectorId: string,
    scene: string,
    userInfo: JsonObject
  ) =>
    pool.maybeOne<SocialQrCodeSession>(sql`
      update ${table}
      set ${fields.userInfo} = ${sql.jsonb(userInfo)}
      where ${fields.connectorId} = ${connectorId}
        and ${fields.scene} = ${scene}
        and ${fields.userInfo} is null
        and ${fields.consumedAt} is null
        and ${fields.expiresAt} > now()
      returning ${sql.join(Object.values(fields), sql`, `)}
    `);

  const consumeConfirmedSessionById = async (
    id: string,
    connectorId: string,
    interactionId: string
  ) =>
    pool.maybeOne<SocialQrCodeSession>(sql`
      update ${table}
      set ${fields.consumedAt} = now()
      where ${fields.id} = ${id}
        and ${fields.connectorId} = ${connectorId}
        and ${fields.interactionId} = ${interactionId}
        and ${fields.userInfo} is not null
        and ${fields.consumedAt} is null
        and ${fields.expiresAt} > now()
      returning ${sql.join(Object.values(fields), sql`, `)}
    `);

  const deleteSessionByIdAndInteractionId = async (id: string, interactionId: string) => {
    const { rowCount } = await pool.query(sql`
      delete from ${table}
      where ${fields.id} = ${id}
        and ${fields.interactionId} = ${interactionId}
    `);

    return rowCount;
  };

  const deleteExpiredSessions = async () => {
    await pool.query(sql`
      delete from ${table}
      where ${fields.expiresAt} < now()
    `);
  };

  return {
    upsertSession,
    findSessionById,
    confirmPendingSessionByConnectorIdAndScene,
    consumeConfirmedSessionById,
    deleteSessionByIdAndInteractionId,
    deleteExpiredSessions,
  };
};
