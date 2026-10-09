import { sql } from '@silverhand/slonik';

import type { AlterationScript } from '../lib/types/alteration.js';

import { applyTableRls, dropTableRls } from './utils/1704934999-tables.js';

const alteration: AlterationScript = {
  up: async (pool) => {
    await pool.query(sql`
      create table social_qr_code_sessions (
        tenant_id varchar(21) not null
          references tenants (id) on update cascade on delete cascade,
        id varchar(21) not null,
        connector_id varchar(128) not null
          references connectors (id) on update cascade on delete cascade,
        interaction_id varchar(64) not null,
        scene varchar(64) not null,
        user_info jsonb /* @use JsonObject */,
        created_at timestamptz not null default(now()),
        expires_at timestamptz not null,
        consumed_at timestamptz,
        primary key (tenant_id, id)
      );
    `);
    await pool.query(sql`
      create unique index social_qr_code_sessions__scene
        on social_qr_code_sessions (tenant_id, scene);
    `);
    await pool.query(sql`
      create unique index social_qr_code_sessions__connector_id_interaction_id
        on social_qr_code_sessions (tenant_id, connector_id, interaction_id);
    `);
    await pool.query(sql`
      create index social_qr_code_sessions__expires_at
        on social_qr_code_sessions (expires_at);
    `);
    await applyTableRls(pool, 'social_qr_code_sessions');
  },
  down: async (pool) => {
    await dropTableRls(pool, 'social_qr_code_sessions');
    await pool.query(sql`
      drop table if exists social_qr_code_sessions;
    `);
  },
};

export default alteration;
