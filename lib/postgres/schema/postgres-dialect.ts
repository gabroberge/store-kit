import type { DialectInfo } from '../../schema/dialect.js';
import { quoteSchema } from '../sql/quote-schema.js';

/** PostgreSQL, as the pieces every dialect shares see it. */
export const POSTGRES: DialectInfo = {
  dialect: 'postgres',
  executors: 'fromPg(pool), fromDrizzle(db), fromTypeOrm(dataSource), fromPrisma(prisma) or fromKysely(db)',
  executorNames: 'fromPg, fromDrizzle, fromTypeOrm, fromPrisma or fromKysely',
  checkSchema: (schema, store) => {
    quoteSchema(schema, store);
  },
};
