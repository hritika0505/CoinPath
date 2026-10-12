"""
database.py - SQLite Database Configuration for CoinPath
Provides standard SQLite database connection with WAL mode, transactions,
and table schema management for the FastAPI application.
"""

import sqlite3
import os
from contextlib import contextmanager

DB_FILE = os.environ.get("COINPATH_DB_PATH", "coinpath.db")

def get_connection():
    """Returns a new sqlite3 connection configured with foreign keys and row factory."""
    conn = sqlite3.connect(DB_FILE, timeout=10.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL;")
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn

@contextmanager
def get_db():
    """Context manager for atomic SQLite transactions with automatic commit/rollback."""
    conn = get_connection()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

def init_db():
    """Initializes tables and unique constraints."""
    with get_db() as conn:
        conn.executescript("""
        CREATE TABLE IF NOT EXISTS wallets (
            wallet_id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            balance INTEGER NOT NULL DEFAULT 500,
            offline_limit INTEGER NOT NULL DEFAULT 200,
            created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS transactions (
            tx_id TEXT PRIMARY KEY,
            sender TEXT NOT NULL,
            receiver TEXT NOT NULL,
            amount INTEGER NOT NULL,
            status TEXT NOT NULL, -- 'confirmed', 'rejected', 'duplicate'
            note TEXT,
            timestamp INTEGER NOT NULL,
            confirmed_at INTEGER NOT NULL,
            rejection_reason TEXT,
            signature TEXT
        );

        CREATE TABLE IF NOT EXISTS safety_audit (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            wallet_id TEXT,
            event_type TEXT NOT NULL,
            description TEXT NOT NULL,
            metadata TEXT,
            created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS sms_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tx_id TEXT NOT NULL,
            recipient_phone TEXT NOT NULL,
            message_text TEXT NOT NULL,
            status TEXT NOT NULL,
            provider TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            UNIQUE(tx_id, recipient_phone)
        );

        CREATE TABLE IF NOT EXISTS notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            wallet_id TEXT NOT NULL,
            title TEXT NOT NULL,
            message TEXT NOT NULL,
            type TEXT NOT NULL DEFAULT 'info',
            read INTEGER NOT NULL DEFAULT 0,
            metadata TEXT,
            created_at INTEGER NOT NULL
        );
        """)

if __name__ == "__main__":
    init_db()
    print("Database initialized successfully.")
