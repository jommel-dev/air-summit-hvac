/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

function readDatabaseUrl() {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }

  const envPath = path.join(__dirname, '..', '.env');
  const env = fs.readFileSync(envPath, 'utf8');
  const match = env.match(/^DATABASE_URL=(.+)$/m);
  if (!match) {
    throw new Error('DATABASE_URL is not set');
  }

  return match[1].trim();
}

async function main() {
  const sqlPath = path.join(__dirname, '..', 'sql', 'supabase', 'migration_beginning_stock.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  const connectionString = String(readDatabaseUrl())
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
  console.log('Migration applied: migration_beginning_stock.sql');
}

main().catch((error) => {
  console.error('Migration failed:', error.message);
  process.exit(1);
});
