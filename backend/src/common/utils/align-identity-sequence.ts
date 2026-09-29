import { PoolClient } from 'pg';

type QueryExecutor = {
  query: PoolClient['query'];
};

const IDENTITY_TABLES = new Set(['tblbrands', 'tblproducts', 'tblcapacity']);

/**
 * Identity sequences stay behind MAX(id) when rows are inserted with an explicit id
 * (seed data, imports, restores). The next insert then collides on the primary key.
 */
export async function alignIdentitySequence(
  executor: QueryExecutor,
  tableName: string,
): Promise<void> {
  if (!IDENTITY_TABLES.has(tableName)) {
    throw new Error(`Refusing to align identity sequence for ${tableName}`);
  }

  await executor.query(
    `SELECT setval(
       pg_get_serial_sequence($1, 'id'),
       GREATEST(COALESCE((SELECT MAX(id) FROM ${tableName}), 1), 1),
       EXISTS (SELECT 1 FROM ${tableName})
     )`,
    [`public.${tableName}`],
  );
}
