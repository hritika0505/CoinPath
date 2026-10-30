import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';

const DB_PATH = path.resolve(process.cwd(), 'coinpath.db');

export const db = new DatabaseSync(DB_PATH);

// Initialize tables
export function initDatabase() {
  // WAL mode for concurrency
  try {
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA foreign_keys = ON;');
  } catch (err) {
    console.warn('SQLite PRAGMA warning:', err);
  }

  // Users table
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      full_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      public_key TEXT,
      wallet_id TEXT UNIQUE NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  // Wallets table - note default balance is 500 virtual coins, limit is 200
  db.exec(`
    CREATE TABLE IF NOT EXISTS wallets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER UNIQUE NOT NULL,
      wallet_id TEXT UNIQUE NOT NULL,
      balance INTEGER NOT NULL DEFAULT 500,
      max_tx_limit INTEGER NOT NULL DEFAULT 200,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  // Transactions table
  db.exec(`
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      nonce TEXT NOT NULL,
      sender_wallet_id TEXT NOT NULL,
      receiver_wallet_id TEXT NOT NULL,
      amount INTEGER NOT NULL,
      status TEXT NOT NULL, -- 'accepted', 'rejected', 'pending_sync'
      sync_status TEXT NOT NULL, -- 'online_direct', 'synced_offline', 'failed'
      signature TEXT,
      error_reason TEXT,
      created_at TEXT NOT NULL
    );
  `);

  // Nonces table to prevent replay attacks
  db.exec(`
    CREATE TABLE IF NOT EXISTS nonces (
      sender_wallet_id TEXT NOT NULL,
      nonce TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (sender_wallet_id, nonce)
    );
  `);

  // Sessions table
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  // System reserve user for initial funding logs
  const checkReserve = db.prepare('SELECT id FROM users WHERE wallet_id = ?').get('SYSTEM_RESERVE');
  if (!checkReserve) {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO users (username, email, full_name, password_hash, wallet_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('system_reserve', 'system@coinpath.internal', 'CoinPath System Reserve', 'SYSTEM_LOCKED', 'SYSTEM_RESERVE', now);

    const reserveUser = db.prepare('SELECT id FROM users WHERE wallet_id = ?').get('SYSTEM_RESERVE') as { id: number };
    db.prepare(`
      INSERT INTO wallets (user_id, wallet_id, balance, max_tx_limit, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(reserveUser.id, 'SYSTEM_RESERVE', 10000000, 1000000, now);
  }

  console.log('[DB] SQLite database initialized successfully at', DB_PATH);
}
