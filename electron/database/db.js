'use strict';

/**
 * electron/database/db.js
 *
 * Opens (or creates) the SQLite database using Node.js built-in `node:sqlite` (DatabaseSync),
 * sets connection-level PRAGMAs, and runs all pending migrations on every launch.
 *
 * Database location:
 *   Windows: %APPDATA%\HavenPOS\pos-database.db
 */

const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const { app } = require('electron');

let _db = null;

/**
 * Transaction helper for node:sqlite
 * Runs fn inside BEGIN IMMEDIATE / COMMIT.
 * Automatically rolls back on error.
 */
function transaction(fn) {
  if (!_db) throw new Error('[DB] Database not initialised.');
  _db.exec('BEGIN IMMEDIATE');
  try {
    const res = fn(_db);
    _db.exec('COMMIT');
    return res;
  } catch (err) {
    try {
      _db.exec('ROLLBACK');
    } catch (_) {
      // ignore rollback errors if connection was already closed
    }
    throw err;
  }
}

/**
 * Migration runner
 */
function runMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      filename   TEXT    NOT NULL UNIQUE,
      ran_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
  `);

  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  const appliedRows = db.prepare('SELECT filename FROM _migrations').all();
  const applied = new Set(appliedRows.map(r => r.filename));

  const insertMigrationStmt = db.prepare('INSERT INTO _migrations (filename) VALUES (?)');

  for (const filename of files) {
    if (applied.has(filename)) continue;

    const sql = fs.readFileSync(path.join(migrationsDir, filename), 'utf8');

    transaction(() => {
      db.exec(sql);
      insertMigrationStmt.run(filename);
    });

    console.log(`[DB] Migration applied: ${filename}`);
  }
}

/**
 * Initialise database connection
 */
function initDb() {
  if (_db) return _db;

  const userDataPath = (app && typeof app.getPath === 'function')
    ? app.getPath('userData')
    : path.join(process.env.APPDATA || '.', 'HavenPOS');
  const dbPath = process.env.HAVEN_DB_PATH || path.join(userDataPath, 'pos-database.db');

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  console.log(`[DB] Database path: ${dbPath}`);

  _db = new DatabaseSync(dbPath);

  // Set connection-level PRAGMAs
  _db.exec('PRAGMA foreign_keys = ON;');
  _db.exec('PRAGMA journal_mode = WAL;');
  _db.exec('PRAGMA synchronous = NORMAL;');
  _db.exec('PRAGMA temp_store = MEMORY;');
  _db.exec('PRAGMA mmap_size = 268435456;');

  // Attach transaction helper directly onto db instance for convenience
  _db.transaction = transaction;

  runMigrations(_db);

  console.log('[DB] Database ready (using node:sqlite).');
  return _db;
}

function getDb() {
  if (!_db) {
    throw new Error('[DB] Database not initialised. Call initDb() first.');
  }
  return _db;
}

module.exports = { initDb, getDb, transaction };
