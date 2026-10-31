import express, { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { db, initDatabase } from './server/db.ts';
import { verifyP256Signature } from './server/crypto-verify.ts';

// Initialize SQLite database
initDatabase();

const app = express();
const PORT = 3000;

app.use((_req, res, next) => {
  // Explicitly allow camera access for webcams in iframes and top-level pages
  res.setHeader('Permissions-Policy', 'camera=*');
  res.setHeader('Feature-Policy', 'camera *');
  next();
});

app.use(express.json({ limit: '5mb' }));

// Helper: generate random wallet ID e.g. "CP-8349-2194"
function generateWalletId(): string {
  const part1 = Math.floor(1000 + Math.random() * 9000);
  const part2 = Math.floor(1000 + Math.random() * 9000);
  return `CP-${part1}-${part2}`;
}

// Helper: generate session token
function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

// Authentication middleware
interface AuthenticatedRequest extends Request {
  user?: {
    id: number;
    username: string;
    email: string;
    fullName: string;
    publicKey: string | null;
    walletId: string;
    token: string;
  };
}

function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing or invalid authentication token.' });
  }

  const token = authHeader.substring(7).trim();
  try {
    const session = db.prepare(`
      SELECT s.token, s.expires_at, u.id, u.username, u.email, u.full_name, u.public_key, u.wallet_id
      FROM sessions s
      JOIN users u ON s.user_id = u.id
      WHERE s.token = ?
    `).get(token) as any;

    if (!session) {
      return res.status(401).json({ error: 'Session expired or invalid. Please log in again.' });
    }

    if (new Date(session.expires_at).getTime() < Date.now()) {
      db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
      return res.status(401).json({ error: 'Session expired. Please log in again.' });
    }

    req.user = {
      id: session.id,
      username: session.username,
      email: session.email,
      fullName: session.full_name,
      publicKey: session.public_key,
      walletId: session.wallet_id,
      token: session.token,
    };

    next();
  } catch (err: any) {
    console.error('[Auth] Error verifying session:', err);
    res.status(500).json({ error: 'Authentication internal error.' });
  }
}

// --------------------------------------------------------------------------
// API ROUTES
// --------------------------------------------------------------------------

// Health check
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    app: 'CoinPath Virtual Wallet',
    version: '1.0.0',
    serverTime: new Date().toISOString(),
    network: 'online',
  });
});

// Register account
app.post('/api/auth/register', async (req, res) => {
  const { username, email, fullName, password, publicKey } = req.body;

  if (!username || !email || !fullName || !password) {
    return res.status(400).json({ error: 'All fields (username, email, full name, password) are required.' });
  }

  const trimmedUsername = String(username).trim().toLowerCase();
  const trimmedEmail = String(email).trim().toLowerCase();
  const trimmedName = String(fullName).trim();

  // Validate format
  if (trimmedUsername.length < 3 || !/^[a-zA-Z0-9_]+$/.test(trimmedUsername)) {
    return res.status(400).json({ error: 'Username must be at least 3 characters and contain only letters, numbers, and underscores.' });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(trimmedEmail)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  if (String(password).length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
  }

  try {
    // Check for duplicate username or email
    const existingUser = db.prepare('SELECT id, username, email FROM users WHERE username = ? OR email = ?').get(trimmedUsername, trimmedEmail) as any;
    if (existingUser) {
      if (existingUser.username === trimmedUsername) {
        return res.status(409).json({ error: 'An account with this username already exists.' });
      }
      return res.status(409).json({ error: 'An account with this email address already exists.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    // Generate unique wallet ID
    let walletId = generateWalletId();
    let collision = db.prepare('SELECT id FROM users WHERE wallet_id = ?').get(walletId);
    while (collision) {
      walletId = generateWalletId();
      collision = db.prepare('SELECT id FROM users WHERE wallet_id = ?').get(walletId);
    }

    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const token = generateToken();

    // Atomic SQLite transaction to create user and wallet with EXACTLY 500 INITIAL VIRTUAL COINS
    db.exec('BEGIN TRANSACTION;');
    try {
      db.prepare(`
        INSERT INTO users (username, email, full_name, password_hash, public_key, wallet_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(trimmedUsername, trimmedEmail, trimmedName, passwordHash, publicKey || null, walletId, now);

      const createdUser = db.prepare('SELECT id FROM users WHERE username = ?').get(trimmedUsername) as { id: number };

      // Initialize wallet with exactly 500 virtual coins as required by Section 18.B
      const INITIAL_BALANCE = 500;
      const DEFAULT_LIMIT = 200;

      db.prepare(`
        INSERT INTO wallets (user_id, wallet_id, balance, max_tx_limit, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(createdUser.id, walletId, INITIAL_BALANCE, DEFAULT_LIMIT, now);

      // Record genesis initial credit transaction
      const initialTxId = `tx_init_${crypto.randomBytes(8).toString('hex')}`;
      db.prepare(`
        INSERT INTO transactions (id, nonce, sender_wallet_id, receiver_wallet_id, amount, status, sync_status, error_reason, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        initialTxId,
        'genesis_nonce',
        'SYSTEM_RESERVE',
        walletId,
        INITIAL_BALANCE,
        'accepted',
        'online_direct',
        null,
        now
      );

      // Create session
      db.prepare(`
        INSERT INTO sessions (token, user_id, created_at, expires_at)
        VALUES (?, ?, ?, ?)
      `).run(token, createdUser.id, now, expiresAt);

      db.exec('COMMIT;');

      res.status(201).json({
        token,
        user: {
          id: createdUser.id,
          username: trimmedUsername,
          email: trimmedEmail,
          fullName: trimmedName,
          walletId,
          publicKey: publicKey || null,
        },
        wallet: {
          walletId,
          balance: INITIAL_BALANCE,
          maxTxLimit: DEFAULT_LIMIT,
        },
      });
    } catch (txErr) {
      db.exec('ROLLBACK;');
      throw txErr;
    }
  } catch (err: any) {
    console.error('[Register] Error creating user:', err);
    res.status(500).json({ error: 'Failed to create account. Please try again.' });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  const { usernameOrEmail, password } = req.body;

  if (!usernameOrEmail || !password) {
    return res.status(400).json({ error: 'Please enter both username/email and password.' });
  }

  const query = String(usernameOrEmail).trim().toLowerCase();

  try {
    const user = db.prepare(`
      SELECT u.id, u.username, u.email, u.full_name, u.password_hash, u.public_key, u.wallet_id,
             w.balance, w.max_tx_limit
      FROM users u
      LEFT JOIN wallets w ON u.id = w.user_id
      WHERE LOWER(u.username) = ? OR LOWER(u.email) = ?
    `).get(query, query) as any;

    if (!user) {
      return res.status(401).json({ error: 'Invalid username/email or password.' });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid username/email or password.' });
    }

    const token = generateToken();
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    db.prepare(`
      INSERT INTO sessions (token, user_id, created_at, expires_at)
      VALUES (?, ?, ?, ?)
    `).run(token, user.id, now, expiresAt);

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        fullName: user.full_name,
        walletId: user.wallet_id,
        publicKey: user.public_key,
      },
      wallet: {
        walletId: user.wallet_id,
        balance: user.balance,
        maxTxLimit: user.max_tx_limit,
      },
    });
  } catch (err: any) {
    console.error('[Login] Error during login:', err);
    res.status(500).json({ error: 'Internal login error. Please try again.' });
  }
});

// Logout
app.post('/api/auth/logout', requireAuth, (req: AuthenticatedRequest, res) => {
  try {
    if (req.user?.token) {
      db.prepare('DELETE FROM sessions WHERE token = ?').run(req.user.token);
    }
    res.json({ success: true, message: 'Logged out successfully.' });
  } catch (err: any) {
    console.error('[Logout] Error:', err);
    res.status(500).json({ error: 'Failed to terminate session.' });
  }
});

// Update user public key (for cryptographic keypair association)
app.post('/api/auth/update-public-key', requireAuth, (req: AuthenticatedRequest, res) => {
  const { publicKey } = req.body;
  if (!publicKey || typeof publicKey !== 'string') {
    return res.status(400).json({ error: 'Invalid public key.' });
  }

  try {
    db.prepare('UPDATE users SET public_key = ? WHERE id = ?').run(publicKey, req.user!.id);
    res.json({ success: true, publicKey });
  } catch (err: any) {
    console.error('[UpdatePubKey] Error:', err);
    res.status(500).json({ error: 'Failed to update public key.' });
  }
});

// Get current user wallet details & recent transactions
app.get('/api/wallet/me', requireAuth, (req: AuthenticatedRequest, res) => {
  try {
    const wallet = db.prepare(`
      SELECT wallet_id, balance, max_tx_limit, updated_at
      FROM wallets
      WHERE user_id = ?
    `).get(req.user!.id) as any;

    if (!wallet) {
      return res.status(404).json({ error: 'Wallet not found for user.' });
    }

    const transactions = db.prepare(`
      SELECT id, nonce, sender_wallet_id, receiver_wallet_id, amount, status, sync_status, error_reason, created_at
      FROM transactions
      WHERE sender_wallet_id = ? OR receiver_wallet_id = ?
      ORDER BY created_at DESC
      LIMIT 20
    `).all(wallet.wallet_id, wallet.wallet_id);

    res.json({
      user: {
        id: req.user!.id,
        username: req.user!.username,
        email: req.user!.email,
        fullName: req.user!.fullName,
        walletId: req.user!.walletId,
        publicKey: req.user!.publicKey,
      },
      wallet: {
        walletId: wallet.wallet_id,
        balance: wallet.balance,
        maxTxLimit: wallet.max_tx_limit,
        updatedAt: wallet.updated_at,
      },
      recentTransactions: transactions,
    });
  } catch (err: any) {
    console.error('[WalletMe] Error:', err);
    res.status(500).json({ error: 'Failed to retrieve wallet information.' });
  }
});

// Lookup recipient by wallet ID
app.get('/api/wallet/recipient/:walletId', (req, res) => {
  const { walletId } = req.params;
  if (!walletId) {
    return res.status(400).json({ error: 'Wallet ID is required.' });
  }

  try {
    const recipient = db.prepare(`
      SELECT u.username, u.full_name, w.wallet_id
      FROM wallets w
      JOIN users u ON w.user_id = u.id
      WHERE w.wallet_id = ?
    `).get(walletId) as any;

    if (!recipient) {
      return res.status(404).json({ error: 'Recipient wallet not found. Verify the wallet ID or QR code.' });
    }

    res.json({
      exists: true,
      walletId: recipient.wallet_id,
      username: recipient.username,
      fullName: recipient.full_name,
    });
  } catch (err: any) {
    console.error('[RecipientLookup] Error:', err);
    res.status(500).json({ error: 'Failed to verify recipient.' });
  }
});

// Send coins (real atomic transfer with limit enforcement, idempotency, and signature verification)
app.post('/api/wallet/transfer', requireAuth, (req: AuthenticatedRequest, res) => {
  const { txId, receiverWalletId, amount, nonce, signature, offlineQueuedAt } = req.body;
  const senderWalletId = req.user!.walletId;

  // 1. Basic validation
  if (!txId || typeof txId !== 'string') {
    return res.status(400).json({ error: 'Transaction ID is required for idempotency.' });
  }

  if (!receiverWalletId || typeof receiverWalletId !== 'string') {
    return res.status(400).json({ error: 'Receiver wallet ID is required.' });
  }

  const cleanReceiverId = receiverWalletId.trim();
  if (senderWalletId === cleanReceiverId) {
    return res.status(400).json({ error: 'Cannot transfer virtual coins to your own wallet.' });
  }

  const numericAmount = Number(amount);
  if (!Number.isInteger(numericAmount) || numericAmount <= 0) {
    return res.status(400).json({ error: 'Transfer amount must be a positive integer.' });
  }

  // 2. Idempotency check: Has this transaction already been processed?
  const existingTx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(txId) as any;
  if (existingTx) {
    // Return existing transaction status without double debiting!
    const senderWallet = db.prepare('SELECT balance, max_tx_limit FROM wallets WHERE wallet_id = ?').get(senderWalletId) as any;
    return res.json({
      status: existingTx.status,
      transaction: existingTx,
      balance: senderWallet.balance,
      message: existingTx.status === 'accepted' ? 'Transaction already processed successfully.' : 'Transaction already recorded with rejection.',
    });
  }

  // 3. Sender wallet and limit check
  const senderWallet = db.prepare('SELECT id, balance, max_tx_limit FROM wallets WHERE wallet_id = ?').get(senderWalletId) as any;
  if (!senderWallet) {
    return res.status(404).json({ error: 'Sender wallet not found.' });
  }

  const maxLimit = senderWallet.max_tx_limit || 200;
  if (numericAmount > maxLimit) {
    // Exact requirement Section 6: "Transfer limit exceeded. The maximum allowed per transaction is 200 coins."
    return res.status(400).json({
      error: `Transfer limit exceeded. The maximum allowed per transaction is ${maxLimit} coins.`,
      maxLimit,
    });
  }

  // 4. Receiver wallet check
  const receiverWallet = db.prepare('SELECT id, balance FROM wallets WHERE wallet_id = ?').get(cleanReceiverId) as any;
  if (!receiverWallet) {
    return res.status(404).json({ error: 'Receiver wallet does not exist.' });
  }

  // 5. Balance check
  if (senderWallet.balance < numericAmount) {
    return res.status(400).json({
      error: `Insufficient virtual coins. Available balance: ${senderWallet.balance} coins, requested: ${numericAmount} coins.`,
    });
  }

  // 6. Nonce check for replay protection
  const txNonce = nonce || `nonce_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const existingNonce = db.prepare('SELECT nonce FROM nonces WHERE sender_wallet_id = ? AND nonce = ?').get(senderWalletId, txNonce);
  if (existingNonce) {
    return res.status(400).json({ error: 'Duplicate nonce detected. Potential replay attack blocked.' });
  }

  // 7. Signature verification if public key is registered and signature provided
  if (req.user?.publicKey && signature) {
    const payload = JSON.stringify({
      senderWalletId,
      receiverWalletId: cleanReceiverId,
      amount: numericAmount,
      nonce: txNonce,
    });

    const isSigValid = verifyP256Signature({
      publicKeySpkiBase64: req.user.publicKey,
      payload,
      signatureHex: signature,
    });

    if (!isSigValid) {
      return res.status(400).json({ error: 'Cryptographic signature verification failed.' });
    }
  }

  // 8. Atomic database transaction to debit sender and credit receiver
  const now = new Date().toISOString();
  db.exec('BEGIN TRANSACTION;');
  try {
    db.prepare('UPDATE wallets SET balance = balance - ?, updated_at = ? WHERE wallet_id = ?').run(numericAmount, now, senderWalletId);
    db.prepare('UPDATE wallets SET balance = balance + ?, updated_at = ? WHERE wallet_id = ?').run(numericAmount, now, cleanReceiverId);
    db.prepare('INSERT INTO nonces (sender_wallet_id, nonce, created_at) VALUES (?, ?, ?)').run(senderWalletId, txNonce, now);

    const syncStatus = offlineQueuedAt ? 'synced_offline' : 'online_direct';

    db.prepare(`
      INSERT INTO transactions (id, nonce, sender_wallet_id, receiver_wallet_id, amount, status, sync_status, signature, error_reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      txId,
      txNonce,
      senderWalletId,
      cleanReceiverId,
      numericAmount,
      'accepted',
      syncStatus,
      signature || null,
      null,
      offlineQueuedAt || now
    );

    db.exec('COMMIT;');

    const updatedSender = db.prepare('SELECT balance FROM wallets WHERE wallet_id = ?').get(senderWalletId) as any;

    res.json({
      status: 'accepted',
      transaction: {
        id: txId,
        nonce: txNonce,
        senderWalletId,
        receiverWalletId: cleanReceiverId,
        amount: numericAmount,
        status: 'accepted',
        syncStatus,
        createdAt: offlineQueuedAt || now,
      },
      balance: updatedSender.balance,
      message: `Successfully transferred ${numericAmount} virtual coins to ${cleanReceiverId}.`,
    });
  } catch (err: any) {
    db.exec('ROLLBACK;');
    console.error('[Transfer] Atomic execution error:', err);
    res.status(500).json({ error: 'Database transfer failed. Balances were not altered.' });
  }
});

// Offline synchronization endpoint
app.post('/api/wallet/sync-offline', requireAuth, (req: AuthenticatedRequest, res) => {
  const { transactions } = req.body;
  const senderWalletId = req.user!.walletId;

  if (!Array.isArray(transactions) || transactions.length === 0) {
    return res.status(400).json({ error: 'No offline transactions provided for synchronization.' });
  }

  const results: {
    synced: any[];
    rejected: any[];
    alreadyProcessed: any[];
  } = {
    synced: [],
    rejected: [],
    alreadyProcessed: [],
  };

  for (const item of transactions) {
    const { txId, receiverWalletId, amount, nonce, signature, queuedAt } = item;

    // Check existing
    const existing = db.prepare('SELECT * FROM transactions WHERE id = ?').get(txId) as any;
    if (existing) {
      results.alreadyProcessed.push({ txId, status: existing.status, reason: 'Already in ledger' });
      continue;
    }

    const numericAmount = Number(amount);
    const cleanReceiverId = String(receiverWalletId || '').trim();
    // Allow item.senderWalletId if submitted by receiver voucher, defaulting to authenticated user's wallet
    const actualSenderWalletId = String(item.senderWalletId || senderWalletId).trim();

    // Look up sender's current wallet and user record
    const senderWallet = db.prepare(`
      SELECT w.id, w.balance, w.max_tx_limit, u.public_key, u.username, u.full_name
      FROM wallets w
      JOIN users u ON w.user_id = u.id
      WHERE w.wallet_id = ?
    `).get(actualSenderWalletId) as any;

    const maxLimit = senderWallet?.max_tx_limit || 200;

    // Validation checks
    let rejectionReason: string | null = null;
    if (!senderWallet) {
      rejectionReason = `Sender wallet ${actualSenderWalletId} does not exist.`;
    } else if (!Number.isInteger(numericAmount) || numericAmount <= 0) {
      rejectionReason = 'Invalid transfer amount.';
    } else if (cleanReceiverId === actualSenderWalletId) {
      rejectionReason = 'Cannot transfer to self.';
    } else if (numericAmount > maxLimit) {
      rejectionReason = `Transfer limit exceeded. Maximum per transaction is ${maxLimit} coins.`;
    } else {
      const receiver = db.prepare('SELECT id FROM wallets WHERE wallet_id = ?').get(cleanReceiverId);
      if (!receiver) {
        rejectionReason = `Receiver wallet ${cleanReceiverId} does not exist.`;
      } else if (senderWallet.balance < numericAmount) {
        rejectionReason = `Insufficient balance. Available: ${senderWallet.balance}, requested: ${numericAmount}.`;
      }
    }

    // Nonce check
    const txNonce = nonce || `sync_nonce_${txId}`;
    if (!rejectionReason) {
      const existingNonce = db.prepare('SELECT nonce FROM nonces WHERE sender_wallet_id = ? AND nonce = ?').get(actualSenderWalletId, txNonce);
      if (existingNonce) {
        rejectionReason = 'Nonce replay detected.';
      }
    }

    // Cryptographic signature check if sender has registered public key and signature is provided
    if (!rejectionReason && senderWallet?.public_key && signature) {
      const payload = JSON.stringify({
        senderWalletId: actualSenderWalletId,
        receiverWalletId: cleanReceiverId,
        amount: numericAmount,
        nonce: txNonce,
      });

      const isSigValid = verifyP256Signature({
        publicKeySpkiBase64: senderWallet.public_key,
        payload,
        signatureHex: signature,
      });

      if (!isSigValid) {
        rejectionReason = 'Invalid cryptographic signature.';
      }
    }

    const now = new Date().toISOString();

    if (rejectionReason) {
      // Record rejected transaction to preserve audit history
      try {
        db.prepare(`
          INSERT INTO transactions (id, nonce, sender_wallet_id, receiver_wallet_id, amount, status, sync_status, signature, error_reason, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          txId,
          txNonce,
          actualSenderWalletId,
          cleanReceiverId,
          numericAmount || 0,
          'rejected',
          'failed',
          signature || null,
          rejectionReason,
          queuedAt || now
        );
      } catch (err) {
        console.warn('Failed to record rejected tx:', err);
      }

      results.rejected.push({
        txId,
        senderWalletId: actualSenderWalletId,
        receiverWalletId: cleanReceiverId,
        amount: numericAmount,
        reason: rejectionReason,
      });
      continue;
    }

    // Apply atomic commit
    db.exec('BEGIN TRANSACTION;');
    try {
      db.prepare('UPDATE wallets SET balance = balance - ?, updated_at = ? WHERE wallet_id = ?').run(numericAmount, now, actualSenderWalletId);
      db.prepare('UPDATE wallets SET balance = balance + ?, updated_at = ? WHERE wallet_id = ?').run(numericAmount, now, cleanReceiverId);
      db.prepare('INSERT INTO nonces (sender_wallet_id, nonce, created_at) VALUES (?, ?, ?)').run(actualSenderWalletId, txNonce, now);

      db.prepare(`
        INSERT INTO transactions (id, nonce, sender_wallet_id, receiver_wallet_id, amount, status, sync_status, signature, error_reason, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        txId,
        txNonce,
        actualSenderWalletId,
        cleanReceiverId,
        numericAmount,
        'accepted',
        'synced_offline',
        signature || null,
        null,
        queuedAt || now
      );

      db.exec('COMMIT;');

      results.synced.push({
        txId,
        senderWalletId: actualSenderWalletId,
        receiverWalletId: cleanReceiverId,
        amount: numericAmount,
        status: 'accepted',
      });
    } catch (err: any) {
      db.exec('ROLLBACK;');
      results.rejected.push({
        txId,
        senderWalletId: actualSenderWalletId,
        receiverWalletId: cleanReceiverId,
        amount: numericAmount,
        reason: 'Database atomic commit failure.',
      });
    }
  }

  const updatedWallet = db.prepare('SELECT balance FROM wallets WHERE wallet_id = ?').get(senderWalletId) as any;

  res.json({
    summary: {
      total: transactions.length,
      syncedCount: results.synced.length,
      rejectedCount: results.rejected.length,
      alreadyProcessedCount: results.alreadyProcessed.length,
    },
    results,
    currentBalance: updatedWallet.balance,
  });
});

// Transaction history with filters
app.get('/api/wallet/transactions', requireAuth, (req: AuthenticatedRequest, res) => {
  const walletId = req.user!.walletId;
  const filter = (req.query.filter as string) || 'all'; // 'all', 'sent', 'received', 'pending', 'rejected'

  try {
    let query = `
      SELECT id, nonce, sender_wallet_id, receiver_wallet_id, amount, status, sync_status, error_reason, created_at
      FROM transactions
      WHERE (sender_wallet_id = ? OR receiver_wallet_id = ?)
    `;
    const params: any[] = [walletId, walletId];

    if (filter === 'sent') {
      query += ' AND sender_wallet_id = ?';
      params.push(walletId);
    } else if (filter === 'received') {
      query += ' AND receiver_wallet_id = ?';
      params.push(walletId);
    } else if (filter === 'rejected') {
      query += " AND status = 'rejected'";
    } else if (filter === 'accepted') {
      query += " AND status = 'accepted'";
    }

    query += ' ORDER BY created_at DESC LIMIT 100';

    const txs = db.prepare(query).all(...params);
    res.json({ transactions: txs });
  } catch (err: any) {
    console.error('[Transactions] Error:', err);
    res.status(500).json({ error: 'Failed to fetch transaction history.' });
  }
});

// Transaction detail
app.get('/api/wallet/transactions/:txId', requireAuth, (req: AuthenticatedRequest, res) => {
  const { txId } = req.params;
  const walletId = req.user!.walletId;

  try {
    const tx = db.prepare(`
      SELECT * FROM transactions
      WHERE id = ? AND (sender_wallet_id = ? OR receiver_wallet_id = ?)
    `).get(txId, walletId, walletId);

    if (!tx) {
      return res.status(404).json({ error: 'Transaction not found or access denied.' });
    }

    res.json({ transaction: tx });
  } catch (err: any) {
    console.error('[TxDetail] Error:', err);
    res.status(500).json({ error: 'Failed to load transaction details.' });
  }
});

// Update transfer limit setting
app.post('/api/wallet/settings/limit', requireAuth, (req: AuthenticatedRequest, res) => {
  const { maxTxLimit } = req.body;
  const numericLimit = Number(maxTxLimit);

  if (!Number.isInteger(numericLimit) || numericLimit < 10 || numericLimit > 2000) {
    return res.status(400).json({ error: 'Transaction limit must be an integer between 10 and 2,000 coins.' });
  }

  try {
    db.prepare('UPDATE wallets SET max_tx_limit = ?, updated_at = ? WHERE wallet_id = ?')
      .run(numericLimit, new Date().toISOString(), req.user!.walletId);

    res.json({
      success: true,
      maxTxLimit: numericLimit,
      message: `Transaction limit updated to ${numericLimit} coins per transfer.`,
    });
  } catch (err: any) {
    console.error('[SettingsLimit] Error:', err);
    res.status(500).json({ error: 'Failed to update transaction limit.' });
  }
});

// Virtual test coin faucet (safe demo test coin provisioning)
app.post('/api/wallet/faucet', requireAuth, (req: AuthenticatedRequest, res) => {
  const walletId = req.user!.walletId;
  const FAUCET_AMOUNT = 50;

  try {
    const now = new Date().toISOString();
    const txId = `tx_faucet_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

    db.exec('BEGIN TRANSACTION;');
    db.prepare('UPDATE wallets SET balance = balance + ?, updated_at = ? WHERE wallet_id = ?').run(FAUCET_AMOUNT, now, walletId);
    db.prepare(`
      INSERT INTO transactions (id, nonce, sender_wallet_id, receiver_wallet_id, amount, status, sync_status, error_reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      txId,
      `faucet_nonce_${Date.now()}`,
      'SYSTEM_RESERVE',
      walletId,
      FAUCET_AMOUNT,
      'accepted',
      'online_direct',
      null,
      now
    );
    db.exec('COMMIT;');

    const wallet = db.prepare('SELECT balance FROM wallets WHERE wallet_id = ?').get(walletId) as any;

    res.json({
      success: true,
      added: FAUCET_AMOUNT,
      newBalance: wallet.balance,
      message: `Added ${FAUCET_AMOUNT} virtual test coins from System Reserve for testing.`,
    });
  } catch (err: any) {
    db.exec('ROLLBACK;');
    console.error('[Faucet] Error:', err);
    res.status(500).json({ error: 'Faucet operation failed.' });
  }
});

// --------------------------------------------------------------------------
// VITE DEV SERVER OR STATIC FILE SERVING
// --------------------------------------------------------------------------

async function startServer() {
  const isProduction = process.env.NODE_ENV === 'production';

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[CoinPath Server] running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('[Server] Failed to start:', err);
  process.exit(1);
});
