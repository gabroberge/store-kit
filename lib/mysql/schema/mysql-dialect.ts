import type { DialectInfo } from '../../schema/dialect.js';
import { checkSchema } from '../sql/identifiers.js';

/** MySQL, as the pieces every dialect shares see it. */
export const MYSQL: DialectInfo = {
  dialect: 'mysql',
  executors: 'fromMysql2(pool), fromDrizzle(db), fromTypeOrm(dataSource), fromPrisma(prisma) or fromKysely(db)',
  executorNames: 'fromMysql2, fromDrizzle, fromTypeOrm, fromPrisma or fromKysely',
  checkSchema: (schema, store) => {
    checkSchema(schema, store);
  },
};
