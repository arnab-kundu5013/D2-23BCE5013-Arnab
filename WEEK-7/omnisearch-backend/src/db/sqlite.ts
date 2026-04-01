import knex, { Knex } from 'knex';
import path from 'path';
import fs from 'fs';
import { SQLITE_PATH } from '../config/env';
import logger from '../middleware/logger';

// Ensure data directory exists before Knex opens the file
const dataDir = path.dirname(SQLITE_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db: Knex = knex({
  client: 'sqlite3',
  connection: { filename: SQLITE_PATH },
  useNullAsDefault: true,
  // sqlite3 does not support creating a pool larger than 1 in WAL mode safely
  pool: { min: 1, max: 1 },
});

async function runMigrations() {
  await db.schema.createTableIfNotExists('files', (t) => {
    t.string('id').primary();
    t.string('original_name').notNullable();
    t.string('stored_path').notNullable();
    t.string('file_type').notNullable();
    t.string('mime_type').notNullable();
    t.integer('size_bytes').notNullable();
    t.string('status').notNullable().defaultTo('queued');
    t.text('tags').defaultTo('[]');
    t.text('description').nullable();
    t.integer('chunks_indexed').defaultTo(0);
    t.text('error_message').nullable();
    t.string('created_at').notNullable();
    t.string('updated_at').notNullable();
  });

  await db.schema.createTableIfNotExists('cross_modal_links', (t) => {
    t.string('id').primary();
    t.string('source_file_id').notNullable().references('id').inTable('files').onDelete('CASCADE');
    t.string('target_file_id').notNullable().references('id').inTable('files').onDelete('CASCADE');
    t.string('source_chunk_id').nullable();
    t.string('target_chunk_id').nullable();
    t.string('link_type').notNullable();
    t.float('confidence').notNullable().defaultTo(0.0);
    t.string('created_at').notNullable();
  });

  // Enable WAL via raw pragma for better concurrent read performance
  await db.raw('PRAGMA journal_mode = WAL');
  await db.raw('PRAGMA foreign_keys = ON');

  logger.info('SQLite migrations applied successfully');
}

// Export a promise so other modules can await DB readiness
export const dbReady = runMigrations().catch((err) => {
  logger.error('SQLite migration failed', err);
  process.exit(1);
});

export default db;
