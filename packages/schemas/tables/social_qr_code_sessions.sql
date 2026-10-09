/* init_order = 2 */

/** Browser-bound WeChat MP QR sign-in sessions, created by the QR initiation endpoint and confirmed by the public WeChat event callback. */
create table social_qr_code_sessions (
  tenant_id varchar(21) not null
    references tenants (id) on update cascade on delete cascade,
  /** The verification ID of the owning Social verification record, doubles as the row identifier. */
  id varchar(21) not null,
  /** The connector (DB entry id) that owns this QR session. */
  connector_id varchar(128) not null
    references connectors (id) on update cascade on delete cascade,
  /** The OIDC interaction jti that initiated the QR session, binds polling and consumption to the originating browser's interaction. */
  interaction_id varchar(64) not null,
  /** The high-entropy WeChat QR scene string (64-char WeChat limit, prefixed random string). Unique per session and the only public handle WeChat sees. */
  scene varchar(64) not null,
  /** The authenticated social user info captured from the first qualifying SCAN/subscribe event. Null until confirmed. */
  user_info jsonb /* @use JsonObject */,
  created_at timestamptz not null default(now()),
  expires_at timestamptz not null,
  /** Set exactly once when the confirmed session is consumed by the verify endpoint. */
  consumed_at timestamptz,
  primary key (tenant_id, id)
);

create unique index social_qr_code_sessions__scene
  on social_qr_code_sessions (tenant_id, scene);

/** At most one active QR session per browser interaction and connector; a refresh replaces the row atomically. */
create unique index social_qr_code_sessions__connector_id_interaction_id
  on social_qr_code_sessions (tenant_id, connector_id, interaction_id);

create index social_qr_code_sessions__expires_at
  on social_qr_code_sessions (expires_at);
