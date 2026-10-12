/**
 * server.ts - CoinPath Full-Stack Dev & Production Server
 *
 * Implements the authoritative CoinPath SQLite database & REST API:
 * - SQLite schema with UNIQUE(tx_id) duplicate-payment constraints
 * - Transactional balance debit/credit atomic updates
 * - Idempotent sync endpoint (/api/transactions/sync)
 * - Offline spending limit verification on server
 * - Safety Dashboard statistics & security event logs
 * - SMS notification mock & Twilio dispatcher
 * - Vite middleware integration for live preview on port 3000
 */

import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

app.use(express.json());

// Initialize SQLite database
const DB_PATH = path.join(__dirname, 'coinpath.db');
const db = new DatabaseSync(DB_PATH);

// Enable WAL mode for high concurrency
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

// Initialize tables
db.exec(`
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
    status TEXT NOT NULL, -- 'sent', 'mock_sent', 'failed'
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
`);

console.log('✓ CoinPath SQLite database initialized at', DB_PATH);

// ==========================================
// SMS Notification Service Helper
// ==========================================
function sendTransactionSMS(txId: string, phone: string, amount: number, sender: string, receiver: string) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromPhone = process.env.TWILIO_PHONE_NUMBER;

  const messageText = `[CoinPath Alert] Payment of ${amount} coins successfully confirmed. From: ${sender} To: ${receiver}. Ref: ${txId}`;

  // Check if already dispatched for this tx_id (deduplication constraint)
  try {
    const existing = db.prepare('SELECT id FROM sms_logs WHERE tx_id = ?').get(txId);
    if (existing) {
      console.log(`[SMS Engine] Duplicate SMS suppressed for confirmed tx ${txId}`);
      return;
    }
  } catch (e) {
    // ignore
  }

  if (accountSid && authToken && fromPhone) {
    // Real Twilio credentials present
    try {
      const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
      const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
      const params = new URLSearchParams();
      params.append('To', phone);
      params.append('From', fromPhone);
      params.append('Body', messageText);

      fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params.toString()
      }).then(res => {
        const status = res.ok ? 'sent' : 'failed';
        db.prepare(`
          INSERT OR IGNORE INTO sms_logs (tx_id, recipient_phone, message_text, status, provider, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(txId, phone, messageText, status, 'twilio', Date.now());
      }).catch(err => {
        console.warn('Twilio dispatch error:', err);
      });
    } catch (err) {
      console.warn('Failed to call Twilio:', err);
    }
  } else {
    // Safe mock notification mode
    console.log(`[SMS Engine (Mock)] Notification dispatched to ${phone}: "${messageText}"`);
    try {
      db.prepare(`
        INSERT OR IGNORE INTO sms_logs (tx_id, recipient_phone, message_text, status, provider, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(txId, phone, messageText, 'mock_sent', 'mock_sandbox', Date.now());
    } catch (e) {
      // ignore
    }
  }
}

// ==========================================
// REST API Routes
// ==========================================

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    system: 'CoinPath Server',
    database: 'SQLite',
    timestamp: Date.now()
  });
});

// Wallet creation / retrieval
app.post('/api/wallets', (req, res) => {
  const { wallet_id, name, balance } = req.body;
  if (!wallet_id || !name) {
    return res.status(400).json({ error: 'wallet_id and name are required' });
  }

  const existing = db.prepare('SELECT * FROM wallets WHERE wallet_id = ?').get(wallet_id) as any;
  if (existing) {
    return res.json(existing);
  }

  const initialBalance = typeof balance === 'number' ? balance : 500;
  const now = Date.now();
  db.prepare(`
    INSERT INTO wallets (wallet_id, name, balance, offline_limit, created_at)
    VALUES (?, ?, ?, 200, ?)
  `).run(wallet_id, name, initialBalance, now);

  res.status(201).json({
    wallet_id,
    name,
    balance: initialBalance,
    offline_limit: 200,
    created_at: now
  });
});

app.get('/api/wallets/:wallet_id', (req, res) => {
  const wallet = db.prepare('SELECT * FROM wallets WHERE wallet_id = ?').get(req.params.wallet_id);
  if (!wallet) {
    return res.status(404).json({ error: 'Wallet not found' });
  }
  res.json(wallet);
});

app.get('/api/wallets/:wallet_id/balance', (req, res) => {
  const wallet = db.prepare('SELECT balance FROM wallets WHERE wallet_id = ?').get(req.params.wallet_id) as any;
  if (!wallet) {
    return res.status(404).json({ error: 'Wallet not found' });
  }
  res.json({ wallet_id: req.params.wallet_id, balance: wallet.balance });
});

// Spending limit configuration
app.post('/api/wallets/:wallet_id/limits', (req, res) => {
  const { offline_limit } = req.body;
  const limit = Math.max(10, Math.floor(Number(offline_limit)));
  if (!limit) {
    return res.status(400).json({ error: 'Valid positive offline_limit required' });
  }

  db.prepare('UPDATE wallets SET offline_limit = ? WHERE wallet_id = ?').run(limit, req.params.wallet_id);
  db.prepare(`
    INSERT INTO safety_audit (wallet_id, event_type, description, metadata, created_at)
    VALUES (?, 'LIMIT_UPDATED', ?, ?, ?)
  `).run(req.params.wallet_id, `Offline limit changed to ${limit}`, JSON.stringify({ offline_limit: limit }), Date.now());

  res.json({ wallet_id: req.params.wallet_id, offline_limit: limit });
});

// Direct online transaction creation
app.post('/api/transactions', (req, res) => {
  const { tx_id, sender, receiver, amount, note, timestamp } = req.body;
  if (!tx_id || !sender || !receiver || !amount || amount <= 0) {
    return res.status(400).json({ error: 'Invalid transaction parameters' });
  }

  // Check for duplicate transaction
  const existing = db.prepare('SELECT * FROM transactions WHERE tx_id = ?').get(tx_id) as any;
  if (existing) {
    return res.json({
      status: 'duplicate',
      message: 'Transaction already processed',
      transaction: existing
    });
  }

  // Ensure wallets exist
  let senderWallet = db.prepare('SELECT * FROM wallets WHERE wallet_id = ?').get(sender) as any;
  let receiverWallet = db.prepare('SELECT * FROM wallets WHERE wallet_id = ?').get(receiver) as any;

  if (!senderWallet) {
    db.prepare('INSERT INTO wallets (wallet_id, name, balance, offline_limit, created_at) VALUES (?, ?, 500, 200, ?)').run(sender, 'Sender User', Date.now());
    senderWallet = { wallet_id: sender, balance: 500 };
  }
  if (!receiverWallet) {
    db.prepare('INSERT INTO wallets (wallet_id, name, balance, offline_limit, created_at) VALUES (?, ?, 500, 200, ?)').run(receiver, 'Receiver User', Date.now());
    receiverWallet = { wallet_id: receiver, balance: 500 };
  }

  if (senderWallet.balance < amount) {
    return res.status(400).json({ error: 'Insufficient balance' });
  }

  const now = Date.now();
  try {
    // Atomic balance update
    db.exec('BEGIN TRANSACTION;');
    db.prepare('UPDATE wallets SET balance = balance - ? WHERE wallet_id = ?').run(amount, sender);
    db.prepare('UPDATE wallets SET balance = balance + ? WHERE wallet_id = ?').run(amount, receiver);
    db.prepare(`
      INSERT INTO transactions (tx_id, sender, receiver, amount, status, note, timestamp, confirmed_at)
      VALUES (?, ?, ?, ?, 'confirmed', ?, ?, ?)
    `).run(tx_id, sender, receiver, amount, note || '', timestamp || now, now);
    db.exec('COMMIT;');

    sendTransactionSMS(tx_id, '+1 555-0199', amount, sender, receiver);

    res.status(201).json({
      status: 'confirmed',
      tx_id,
      sender,
      receiver,
      amount,
      confirmed_at: now
    });
  } catch (err: any) {
    db.exec('ROLLBACK;');
    console.error('Transaction failed:', err);
    res.status(500).json({ error: 'Transaction failed: ' + err.message });
  }
});

// Idempotent batch offline synchronization
app.post('/api/transactions/sync', (req, res) => {
  const { transactions } = req.body;
  if (!Array.isArray(transactions)) {
    return res.status(400).json({ error: 'transactions array required' });
  }

  const results: any[] = [];
  const now = Date.now();

  for (const item of transactions) {
    const { tx_id, sender, receiver, amount, note, timestamp, signature } = item;

    if (!tx_id || !sender || !receiver || !amount) {
      results.push({ tx_id: tx_id || 'unknown', status: 'rejected', reason: 'Missing mandatory fields' });
      continue;
    }

    // 1. DUPLICATE CHECK: Idempotent processing with SQLite UNIQUE constraint
    const existing = db.prepare('SELECT * FROM transactions WHERE tx_id = ?').get(tx_id) as any;
    if (existing) {
      // Record duplicate attempt in safety audit log
      db.prepare(`
        INSERT INTO safety_audit (wallet_id, event_type, description, metadata, created_at)
        VALUES (?, 'DUPLICATE_SYNC_IGNORED', ?, ?, ?)
      `).run(sender, `Duplicate transaction attempt detected for ${tx_id}. Safe idempotency maintained.`, JSON.stringify({ tx_id }), now);

      results.push({
        tx_id,
        status: 'duplicate',
        reason: 'Transaction already settled on server. Idempotent response returned without double debit.',
        confirmed_at: existing.confirmed_at
      });
      continue;
    }

    // 2. Ensure wallets exist
    let senderWallet = db.prepare('SELECT * FROM wallets WHERE wallet_id = ?').get(sender) as any;
    let receiverWallet = db.prepare('SELECT * FROM wallets WHERE wallet_id = ?').get(receiver) as any;

    if (!senderWallet) {
      db.prepare('INSERT INTO wallets (wallet_id, name, balance, offline_limit, created_at) VALUES (?, ?, 500, 200, ?)').run(sender, sender, now);
      senderWallet = { wallet_id: sender, balance: 500, offline_limit: 200 };
    }
    if (!receiverWallet) {
      db.prepare('INSERT INTO wallets (wallet_id, name, balance, offline_limit, created_at) VALUES (?, ?, 500, 200, ?)').run(receiver, receiver, now);
      receiverWallet = { wallet_id: receiver, balance: 500, offline_limit: 200 };
    }

    // 3. BALANCE & SPENDING LIMIT VALIDATION
    if (amount > senderWallet.offline_limit) {
      db.prepare(`
        INSERT INTO transactions (tx_id, sender, receiver, amount, status, note, timestamp, confirmed_at, rejection_reason, signature)
        VALUES (?, ?, ?, ?, 'rejected', ?, ?, ?, 'Exceeds configured offline spending limit', ?)
      `).run(tx_id, sender, receiver, amount, note || '', timestamp || now, now, signature || '');

      results.push({
        tx_id,
        status: 'rejected',
        reason: `Exceeds offline spending limit of ${senderWallet.offline_limit} coins`
      });
      continue;
    }

    if (senderWallet.balance < amount) {
      db.prepare(`
        INSERT INTO transactions (tx_id, sender, receiver, amount, status, note, timestamp, confirmed_at, rejection_reason, signature)
        VALUES (?, ?, ?, ?, 'rejected', ?, ?, ?, 'Insufficient balance on authoritative server', ?)
      `).run(tx_id, sender, receiver, amount, note || '', timestamp || now, now, signature || '');

      results.push({
        tx_id,
        status: 'rejected',
        reason: 'Insufficient wallet balance on authoritative server'
      });
      continue;
    }

    // 4. ATOMIC DATABASE TRANSACTION
    try {
      db.exec('BEGIN TRANSACTION;');
      db.prepare('UPDATE wallets SET balance = balance - ? WHERE wallet_id = ?').run(amount, sender);
      db.prepare('UPDATE wallets SET balance = balance + ? WHERE wallet_id = ?').run(amount, receiver);
      db.prepare(`
        INSERT INTO transactions (tx_id, sender, receiver, amount, status, note, timestamp, confirmed_at, signature)
        VALUES (?, ?, ?, ?, 'confirmed', ?, ?, ?, ?)
      `).run(tx_id, sender, receiver, amount, note || '', timestamp || now, now, signature || '');

      db.prepare(`
        INSERT INTO safety_audit (wallet_id, event_type, description, metadata, created_at)
        VALUES (?, 'OFFLINE_TX_CONFIRMED', ?, ?, ?)
      `).run(sender, `Offline transaction ${tx_id} validated and settled on server`, JSON.stringify({ tx_id, amount }), now);

      db.prepare(`
        INSERT INTO notifications (wallet_id, title, message, type, metadata, created_at)
        VALUES (?, 'Payment Confirmed', ?, 'success', ?, ?)
      `).run(receiver, `Received ${amount} coins from ${sender} (Ref: ${tx_id})`, JSON.stringify({ tx_id, amount }), now);

      db.exec('COMMIT;');

      // Dispatch SMS notification after successful server confirmation
      sendTransactionSMS(tx_id, '+1 555-0199', amount, sender, receiver);

      results.push({
        tx_id,
        status: 'confirmed',
        confirmed_at: now
      });
    } catch (err: any) {
      db.exec('ROLLBACK;');
      console.error('Sync item failure:', err);
      results.push({
        tx_id,
        status: 'rejected',
        reason: 'Database error: ' + err.message
      });
    }
  }

  res.json({
    synced_count: results.filter(r => r.status === 'confirmed').length,
    results
  });
});

// Transaction history for a wallet
app.get('/api/transactions/:wallet_id', (req, res) => {
  const walletId = req.params.wallet_id;
  const txs = db.prepare(`
    SELECT * FROM transactions
    WHERE sender = ? OR receiver = ?
    ORDER BY confirmed_at DESC
  `).all(walletId, walletId);
  res.json(txs);
});

// Safety dashboard statistics & audit logs
app.get('/api/safety/:wallet_id', (req, res) => {
  const walletId = req.params.wallet_id;
  const wallet = db.prepare('SELECT * FROM wallets WHERE wallet_id = ?').get(walletId) as any;

  const confirmedCount = (db.prepare(`
    SELECT COUNT(*) as c FROM transactions WHERE (sender = ? OR receiver = ?) AND status = 'confirmed'
  `).get(walletId, walletId) as any).c;

  const rejectedCount = (db.prepare(`
    SELECT COUNT(*) as c FROM transactions WHERE (sender = ? OR receiver = ?) AND status = 'rejected'
  `).get(walletId, walletId) as any).c;

  const duplicateAttempts = (db.prepare(`
    SELECT COUNT(*) as c FROM safety_audit WHERE wallet_id = ? AND event_type = 'DUPLICATE_SYNC_IGNORED'
  `).get(walletId) as any).c;

  const auditEvents = db.prepare(`
    SELECT * FROM safety_audit WHERE wallet_id = ? OR wallet_id = '' ORDER BY created_at DESC LIMIT 20
  `).all(walletId);

  res.json({
    wallet_id: walletId,
    balance: wallet ? wallet.balance : 0,
    offline_limit: wallet ? wallet.offline_limit : 200,
    metrics: {
      confirmed: confirmedCount,
      rejected: rejectedCount,
      duplicates_neutralized: duplicateAttempts
    },
    audit_events: auditEvents
  });
});

// In-app notifications
app.get('/api/notifications/:wallet_id', (req, res) => {
  const notis = db.prepare(`
    SELECT * FROM notifications WHERE wallet_id = ? ORDER BY created_at DESC LIMIT 30
  `).all(req.params.wallet_id);
  res.json(notis);
});

// ==========================================
// Serve Vite frontend in dev, static in prod
// ==========================================
async function startServer() {
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  } else {
    // In dev mode, mount Vite middleware for instant live reload & static resolution
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 CoinPath Full-Stack App running at http://localhost:${PORT}`);
  });
}

startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
