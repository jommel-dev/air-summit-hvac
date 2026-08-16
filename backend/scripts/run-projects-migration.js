/* eslint-disable no-console */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

async function main() {
  const sqlPath = path.join(
    __dirname,
    '..',
    'sql',
    'supabase',
    'migration_projects_customer_poc_soa.sql',
  );
  const sql = fs.readFileSync(sqlPath, 'utf8');
  const connectionString = String(process.env.DATABASE_URL || '')
    .replace(/[?&]sslmode=[^&]*/gi, '')
    .replace(/\?&/, '?')
    .replace(/[?&]$/, '');

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  await client.query(sql);
  await client.end();
  console.log('Migration applied: migration_projects_customer_poc_soa.sql');
}

main().catch((error) => {
  console.error('Migration failed:', error.message);
  process.exit(1);
});
