import { Pool } from "pg";

// Single shared pool across hot-reloads in dev.
const globalForPg = globalThis as unknown as { pool?: Pool; schemaReady?: Promise<void> };

function getPool(): Pool {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env and fill it in.");
  }
  if (!globalForPg.pool) {
    globalForPg.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      // Most hosted Postgres (Neon/Supabase) require SSL; local usually doesn't.
      ssl: process.env.DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false },
    });
  }
  return globalForPg.pool;
}

// Lazily create the table the first time the DB is touched — no migration step.
async function ensureSchema(): Promise<void> {
  if (!globalForPg.schemaReady) {
    const pool = getPool();
    globalForPg.schemaReady = (async () => {
      await pool.query(
        `CREATE TABLE IF NOT EXISTS users (
           id            SERIAL PRIMARY KEY,
           email         TEXT UNIQUE NOT NULL,
           password_hash TEXT NOT NULL,
           created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
         )`
      );
      await pool.query(
        `CREATE TABLE IF NOT EXISTS locations (
           id         SERIAL PRIMARY KEY,
           user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
           name       TEXT NOT NULL,
           latitude   DOUBLE PRECISION NOT NULL,
           longitude  DOUBLE PRECISION NOT NULL,
           created_at TIMESTAMPTZ NOT NULL DEFAULT now()
         )`
      );
      // For databases created before auth existed: add the column if missing.
      await pool.query(`ALTER TABLE locations ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE`);
    })();
  }
  return globalForPg.schemaReady;
}

export async function query<T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  params?: unknown[]
): Promise<T[]> {
  await ensureSchema();
  const res = await getPool().query(text, params);
  return res.rows as T[];
}
