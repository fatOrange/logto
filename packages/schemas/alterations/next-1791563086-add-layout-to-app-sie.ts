import { sql } from '@silverhand/slonik';

import type { AlterationScript } from '../lib/types/alteration.js';

const alteration: AlterationScript = {
  up: async (pool) => {
    await pool.query(sql`
      alter table application_sign_in_experiences
        add column layout varchar(32);
    `);
  },
  down: async (pool) => {
    await pool.query(sql`
      alter table application_sign_in_experiences
        drop column layout;
    `);
  },
};

export default alteration;
