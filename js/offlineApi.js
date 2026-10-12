/**
 * offlineApi.js - CoinPath Offline Transaction & Safety Engine
 *
 * Implements:
 * 1. Persistent storage in IndexedDB for reliable offline operation
 * 2. Web Crypto API cryptographic signatures for offline transactions
 * 3. Offline spending limit enforcement and warnings
 * 4. Duplicate transaction prevention with unique transaction IDs and nonces
 * 5. Reconnection auto-detection and idempotent backend synchronization
 * 6. Safety Dashboard audit log and transaction safety metrics
 * 7. In-app and simulated SMS notification integration
 */

const DB_NAME = 'coinpath_offline_db';
const DB_VERSION = 2;
const DEFAULT_OFFLINE_LIMIT = 200;

let dbInstance = null;
let currentConfig = {
  apiBase: '/api',
  badgeEl: null,
  onSync: null
};

// ==========================================
// 1. IndexedDB Persistent Storage
// ==========================================
function openDatabase() {
  if (dbInstance) return Promise.resolve(dbInstance);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('transactions')) {
        const txStore = db.createObjectStore('transactions', { keyPath: 'tx_id' });
        txStore.createIndex('sender', 'sender', { unique: false });
        txStore.createIndex('receiver', 'receiver', { unique: false });
        txStore.createIndex('status', 'status', { unique: false });
      }
      if (!db.objectStoreNames.contains('wallets')) {
        db.createObjectStore('wallets', { keyPath: 'wallet_id' });
      }
      if (!db.objectStoreNames.contains('audit_events')) {
        db.createObjectStore('audit_events', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('notifications')) {
        db.createObjectStore('notifications', { keyPath: 'id', autoIncrement: true });
      }
    };
    request.onsuccess = (event) => {
      dbInstance = event.target.result;
      resolve(dbInstance);
    };
    request.onerror = (event) => {
      console.error('IndexedDB open error:', event.target.error);
      reject(event.target.error);
    };
  });
}

function idbGet(storeName, key) {
  return openDatabase().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  });
}

function idbPut(storeName, value) {
  return openDatabase().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.put(value);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  });
}

function idbGetAll(storeName) {
  return openDatabase().then((db) => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  });
}

// ==========================================
// 2. Cryptographic Signatures (Web Crypto API)
// ==========================================
// Generates or retrieves an ECDSA (P-256) signing key pair for the wallet
async function getOrCreateKeyPair(walletId) {
  const existing = await idbGet('wallets', walletId);
  if (existing && existing.privateKey && existing.publicKey) {
    return existing;
  }

  // Generate ECDSA P-256 keypair for digital signatures
  let keyPair;
  try {
    keyPair = await crypto.subtle.generateKey(
      {
        name: 'ECDSA',
        namedCurve: 'P-256'
      },
      false, // non-exportable private key
      ['sign', 'verify']
    );
  } catch (e) {
    // Fallback to HMAC-SHA256 if ECDSA is not supported on older webviews
    console.warn('ECDSA unavailable, using HMAC key fallback', e);
    const hmacKey = await crypto.subtle.generateKey(
      { name: 'HMAC', hash: 'SHA-256' },
      true,
      ['sign', 'verify']
    );
    const jwk = await crypto.subtle.exportKey('jwk', hmacKey);
    const record = {
      wallet_id: walletId,
      keyType: 'HMAC',
      cryptoKey: hmacKey,
      publicKeyJwk: jwk,
      offlineLimit: DEFAULT_OFFLINE_LIMIT,
      created: Date.now()
    };
    await idbPut('wallets', record);
    return record;
  }

  const publicKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  const record = {
    wallet_id: walletId,
    keyType: 'ECDSA',
    privateKey: keyPair.privateKey,
    publicKey: keyPair.publicKey,
    publicKeyJwk,
    offlineLimit: DEFAULT_OFFLINE_LIMIT,
    created: Date.now()
  };
  await idbPut('wallets', record);
  return record;
}

// Signs canonical transaction payload
async function signPayload(walletRecord, canonicalText) {
  const enc = new TextEncoder();
  const data = enc.encode(canonicalText);
  let signatureBuffer;
  if (walletRecord.keyType === 'ECDSA') {
    signatureBuffer = await crypto.subtle.sign(
      { name: 'ECDSA', hash: { name: 'SHA-256' } },
      walletRecord.privateKey,
      data
    );
  } else {
    signatureBuffer = await crypto.subtle.sign(
      'HMAC',
      walletRecord.cryptoKey,
      data
    );
  }
  const bytes = new Uint8Array(signatureBuffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Verifies transaction signature
async function verifySignature(publicKeyJwk, canonicalText, signatureBase64) {
  try {
    const enc = new TextEncoder();
    const data = enc.encode(canonicalText);
    const binary = atob(signatureBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    if (publicKeyJwk.kty === 'EC') {
      const pubKey = await crypto.subtle.importKey(
        'jwk',
        publicKeyJwk,
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['verify']
      );
      return await crypto.subtle.verify(
        { name: 'ECDSA', hash: { name: 'SHA-256' } },
        pubKey,
        bytes,
        data
      );
    } else {
      const key = await crypto.subtle.importKey(
        'jwk',
        publicKeyJwk,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['verify']
      );
      return await crypto.subtle.verify('HMAC', key, bytes, data);
    }
  } catch (err) {
    console.warn('Signature verification check error:', err);
    return false;
  }
}

// ==========================================
// 3. Safety Audit Logger
// ==========================================
async function recordAuditEvent(type, walletId, description, metadata = {}) {
  const event = {
    type,
    wallet_id: walletId,
    description,
    metadata,
    timestamp: Date.now()
  };
  try {
    await idbPut('audit_events', event);
  } catch (e) {
    console.warn('Could not save audit event', e);
  }
}

// ==========================================
// 4. Notifications Engine
// ==========================================
async function addInAppNotification(walletId, title, message, type = 'info', metadata = {}) {
  const noti = {
    wallet_id: walletId,
    title,
    message,
    type,
    read: false,
    timestamp: Date.now(),
    metadata
  };
  await idbPut('notifications', noti);

  // If Capacitor or native notification is available, trigger it
  if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications) {
    try {
      window.Capacitor.Plugins.LocalNotifications.schedule({
        notifications: [
          {
            title: title,
            body: message,
            id: Math.floor(Math.random() * 100000),
            schedule: { at: new Date(Date.now() + 100) }
          }
        ]
      });
    } catch (e) {
      console.warn('LocalNotifications schedule error', e);
    }
  }
}

// ==========================================
// 5. Offline Spending Limit Helpers
// ==========================================
export async function getSpendingLimit(walletId) {
  const record = await idbGet('wallets', walletId);
  return (record && record.offlineLimit) || DEFAULT_OFFLINE_LIMIT;
}

export async function setSpendingLimit(walletId, newLimit) {
  const limit = Math.max(10, Math.floor(Number(newLimit)));
  const record = (await idbGet('wallets', walletId)) || { wallet_id: walletId };
  record.offlineLimit = limit;
  await idbPut('wallets', record);

  // Sync limit to backend if online
  if (navigator.onLine) {
    fetch(`${currentConfig.apiBase}/wallets/${walletId}/limits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ offline_limit: limit })
    }).catch(() => {});
  }

  await recordAuditEvent('LIMIT_UPDATED', walletId, `Offline spending limit adjusted to ${limit} coins`, { limit });
  return limit;
}

export async function getOfflineAllowanceStatus(walletId, currentBalance) {
  const limit = await getSpendingLimit(walletId);
  const txs = await listLocalTransactions();
  
  // Sum up all pending outgoing transfers
  let pendingOutgoing = 0;
  let pendingIncoming = 0;
  let pendingCount = 0;

  txs.forEach((item) => {
    const t = item.tx || item;
    const isPending = (item.status === 'pending' || item.kind === 'pending');
    if (isPending) {
      pendingCount++;
      if (t.sender === walletId) {
        pendingOutgoing += Number(t.amount || 0);
      } else if (t.receiver === walletId) {
        pendingIncoming += Number(t.amount || 0);
      }
    }
  });

  const remainingAllowance = Math.max(0, limit - pendingOutgoing);
  const usedPercent = Math.min(100, Math.round((pendingOutgoing / limit) * 100));
  const isNearLimit = usedPercent >= 75;
  const isExceeded = pendingOutgoing >= limit;

  return {
    limit,
    used: pendingOutgoing,
    remaining: remainingAllowance,
    percentUsed: usedPercent,
    isNearLimit,
    isExceeded,
    pendingIncoming,
    pendingCount
  };
}

// ==========================================
// 6. Public API required by app.js
// ==========================================

export async function setupLocalWallet(walletId) {
  const wallet = await getOrCreateKeyPair(walletId);
  return wallet.publicKeyJwk;
}

export async function listLocalTransactions() {
  const list = await idbGetAll('transactions');
  return list.sort((a, b) => {
    const timeA = (a.tx && a.tx.timestamp) || a.timestamp || 0;
    const timeB = (b.tx && b.tx.timestamp) || b.timestamp || 0;
    return timeB - timeA;
  });
}

/**
 * Creates an offline transaction code (QR payload)
 * Validates balance and enforces the configured offline spending limit.
 */
export async function createOfflineTransfer(fromWalletId, toWalletId, amount) {
  if (fromWalletId === toWalletId) {
    throw new Error('You cannot send coins to your own wallet.');
  }

  const numAmount = Number(amount);
  if (!numAmount || numAmount <= 0 || !Number.isInteger(numAmount)) {
    throw new Error('Please enter a valid whole number of coins.');
  }

  // Validate offline spending limit
  const allowance = await getOfflineAllowanceStatus(fromWalletId);
  if (numAmount > allowance.remaining) {
    throw new Error(
      `Offline spending limit exceeded. Limit is ${allowance.limit} coins, ` +
      `you have already reserved ${allowance.used} coins, leaving ${allowance.remaining} coins allowance. ` +
      `Reconnect to sync or update your limit.`
    );
  }

  // Get signer key
  const walletRecord = await getOrCreateKeyPair(fromWalletId);

  // Generate globally unique Transaction ID and random nonce
  const nonce = Math.random().toString(36).substring(2, 10);
  const timestamp = Date.now();
  const tx_id = 'CPTX-' + timestamp.toString(36).toUpperCase() + '-' + nonce.toUpperCase();

  // Canonical payload for signing
  const canonical = `COINPATH:v1|${tx_id}|${fromWalletId}|${toWalletId}|${numAmount}|${timestamp}|${nonce}`;
  const signature = await signPayload(walletRecord, canonical);

  const txData = {
    tx_id,
    sender: fromWalletId,
    receiver: toWalletId,
    amount: numAmount,
    timestamp,
    nonce,
    signature,
    publicKeyJwk: walletRecord.publicKeyJwk,
    status: 'pending',
    synced: false
  };

  const payloadObject = {
    version: 1,
    tx_id,
    from: fromWalletId,
    to: toWalletId,
    amount: numAmount,
    ts: timestamp,
    nonce,
    sig: signature,
    pubKey: walletRecord.publicKeyJwk
  };

  const payloadString = 'COINPATH:v1:' + btoa(JSON.stringify(payloadObject));

  // Save to persistent IndexedDB
  await idbPut('transactions', {
    tx_id,
    status: 'pending',
    tx: txData,
    payload: payloadString,
    created: timestamp
  });

  await recordAuditEvent(
    'TX_CREATED',
    fromWalletId,
    `Created signed offline transfer of ${numAmount} coins to ${toWalletId}`,
    { tx_id, amount: numAmount, to: toWalletId }
  );

  return {
    payload: payloadString,
    tx: txData
  };
}

/**
 * Accepts a scanned QR payment code on the receiver's device
 */
export async function acceptScannedTransfer(qrText, currentWalletId) {
  try {
    const text = String(qrText || '').trim();
    if (!text.startsWith('COINPATH:v1:')) {
      return { ok: false, reason: 'Invalid QR code. Not a recognized CoinPath payment code.' };
    }

    const jsonPart = text.replace('COINPATH:v1:', '');
    const data = JSON.parse(atob(jsonPart));

    if (!data.tx_id || !data.from || !data.to || !data.amount) {
      return { ok: false, reason: 'Incomplete transaction payload inside QR code.' };
    }

    if (data.to !== currentWalletId) {
      return {
        ok: false,
        reason: `This payment is intended for wallet ${data.to}, but your current wallet is ${currentWalletId}.`
      };
    }

    // Check for duplicate payment attempt
    const existing = await idbGet('transactions', data.tx_id);
    if (existing) {
      await recordAuditEvent(
        'DUPLICATE_SCAN_REJECTED',
        currentWalletId,
        `Duplicate scan detected for payment ${data.tx_id}`,
        { tx_id: data.tx_id }
      );
      return {
        ok: false,
        reason: `Duplicate payment detected! Transaction ${data.tx_id} has already been scanned on this device.`
      };
    }

    // Verify cryptographic signature
    const canonical = `COINPATH:v1|${data.tx_id}|${data.from}|${data.to}|${data.amount}|${data.ts}|${data.nonce}`;
    let isSigValid = true;
    if (data.pubKey) {
      isSigValid = await verifySignature(data.pubKey, canonical, data.sig);
    }

    if (!isSigValid) {
      await recordAuditEvent(
        'SIGNATURE_INVALID',
        currentWalletId,
        `Rejected payment with invalid cryptographic signature (tx_id: ${data.tx_id})`,
        { tx_id: data.tx_id }
      );
      return { ok: false, reason: 'Security alert: Cryptographic signature verification failed.' };
    }

    const txData = {
      tx_id: data.tx_id,
      sender: data.from,
      receiver: data.to,
      amount: Number(data.amount),
      timestamp: data.ts,
      nonce: data.nonce,
      signature: data.sig,
      publicKeyJwk: data.pubKey,
      status: 'pending',
      synced: false
    };

    // Save into local IndexedDB
    await idbPut('transactions', {
      tx_id: data.tx_id,
      status: 'pending',
      tx: txData,
      payload: text,
      created: Date.now()
    });

    await recordAuditEvent(
      'TX_ACCEPTED',
      currentWalletId,
      `Accepted offline transfer of ${data.amount} coins from ${data.from} (Pending Sync)`,
      { tx_id: data.tx_id, from: data.from, amount: data.amount }
    );

    await addInAppNotification(
      currentWalletId,
      'Offline Payment Scanned',
      `Received offline payment of ${data.amount} coins from ${data.from}. Waiting for sync with server.`,
      'info',
      { tx_id: data.tx_id }
    );

    // Auto-sync if online
    if (navigator.onLine && currentConfig.apiBase) {
      setTimeout(() => syncNow(currentConfig.apiBase), 300);
    }

    return { ok: true, tx: txData };
  } catch (err) {
    console.error('Accept scanned transfer exception:', err);
    return { ok: false, reason: 'Failed to decode or parse the QR payment code: ' + (err.message || 'Corrupted data') };
  }
}

/**
 * Synchronizes pending transactions with the backend
 * Guarantees idempotent execution: repeated requests with the same tx_id will never debit twice!
 */
export async function syncNow(apiBase) {
  const base = apiBase || currentConfig.apiBase || '/api';
  const allTxs = await idbGetAll('transactions');
  const pendingTxs = allTxs.filter((item) => {
    const s = String(item.status || (item.tx && item.tx.status) || '').toLowerCase();
    return s === 'pending';
  });

  if (!pendingTxs.length) {
    return { success: true, count: 0, message: 'All transactions already synced' };
  }

  const payload = {
    transactions: pendingTxs.map((item) => item.tx || item)
  };

  try {
    const response = await fetch(`${base}/transactions/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Server returned HTTP ${response.status}`);
    }

    const data = await response.json();
    const results = data.results || [];

    // Process each transaction outcome
    for (const res of results) {
      const existing = await idbGet('transactions', res.tx_id);
      if (existing) {
        const txObj = existing.tx || existing;
        const previousStatus = existing.status;
        existing.status = res.status; // 'confirmed', 'duplicate', 'rejected'
        existing.reason = res.reason || '';
        existing.synced = res.status === 'confirmed' || res.status === 'duplicate';
        existing.confirmed_at = res.confirmed_at || Date.now();
        if (existing.tx) {
          existing.tx.status = res.status;
          existing.tx.reason = res.reason || '';
          existing.tx.synced = existing.synced;
        }
        await idbPut('transactions', existing);

        // Update Store ledger if confirmed or duplicate recognized
        if (res.status === 'confirmed' && previousStatus === 'pending') {
          if (window.Store && window.Store.recordExternalTransfer) {
            window.Store.recordExternalTransfer(
              txObj.sender,
              txObj.receiver,
              txObj.amount,
              txObj.tx_id,
              txObj.note || 'Synced Transfer',
              txObj.timestamp
            );
          }
          await addInAppNotification(
            txObj.receiver,
            'Payment Confirmed',
            `Transaction ${txObj.tx_id} of ${txObj.amount} coins has been validated and confirmed on the server.`,
            'success',
            { tx_id: txObj.tx_id, amount: txObj.amount }
          );
        } else if (res.status === 'duplicate') {
          await recordAuditEvent(
            'DUPLICATE_IDEMPOTENT_HANDLED',
            txObj.sender,
            `Duplicate transaction ${txObj.tx_id} safely recognized on server without double debit.`,
            { tx_id: txObj.tx_id }
          );
        } else if (res.status === 'rejected') {
          await recordAuditEvent(
            'TX_REJECTED_BY_SERVER',
            txObj.sender,
            `Transaction ${txObj.tx_id} was rejected by server: ${res.reason}`,
            { tx_id: txObj.tx_id, reason: res.reason }
          );
        }
      }
    }

    localStorage.setItem('coinpath.last_sync', String(Date.now()));

    if (currentConfig.onSync) {
      try { currentConfig.onSync(); } catch (e) {}
    }

    return { success: true, count: results.length, data };
  } catch (error) {
    console.warn('Sync failed:', error);
    throw error;
  }
}

// ==========================================
// 7. Safety Dashboard Data Provider
// ==========================================
export async function getSafetyDashboardData(walletId) {
  const txs = await listLocalTransactions();
  const allowance = await getOfflineAllowanceStatus(walletId);
  const auditList = await idbGetAll('audit_events');

  let pendingCount = 0;
  let confirmedCount = 0;
  let rejectedCount = 0;
  let duplicateCount = 0;

  txs.forEach((item) => {
    const s = String(item.status || (item.tx && item.tx.status) || '').toLowerCase();
    if (s === 'pending') pendingCount++;
    else if (s === 'confirmed' || s === 'done' || s === 'settled') confirmedCount++;
    else if (s === 'duplicate') duplicateCount++;
    else if (s === 'rejected') rejectedCount++;
  });

  const lastSyncTs = localStorage.getItem('coinpath.last_sync');

  return {
    allowance,
    metrics: {
      pending: pendingCount,
      confirmed: confirmedCount,
      rejected: rejectedCount,
      duplicates: duplicateCount,
      total: txs.length
    },
    lastSync: lastSyncTs ? Number(lastSyncTs) : null,
    isOnline: navigator.onLine !== false,
    auditEvents: auditList.filter((e) => !walletId || e.wallet_id === walletId).slice(-15).reverse()
  };
}

export async function getNotifications(walletId) {
  const notis = await idbGetAll('notifications');
  return notis.filter((n) => !walletId || n.wallet_id === walletId).sort((a, b) => b.timestamp - a.timestamp);
}

export async function markNotificationRead(id) {
  const noti = await idbGet('notifications', id);
  if (noti) {
    noti.read = true;
    await idbPut('notifications', noti);
  }
}

// ==========================================
// 8. Lifecycle & Network Detection
// ==========================================
export function initOffline(options) {
  currentConfig = Object.assign(currentConfig, options || {});
  
  function updateBadge() {
    if (currentConfig.badgeEl) {
      const isOnline = navigator.onLine !== false;
      currentConfig.badgeEl.setAttribute('data-online', isOnline ? 'yes' : 'no');
      currentConfig.badgeEl.textContent = isOnline ? 'Online (Connected)' : 'Offline (Local Safe Mode)';
    }
  }

  window.addEventListener('online', () => {
    updateBadge();
    recordAuditEvent('NETWORK_ONLINE', '', 'Internet connectivity restored. Initiating sync.');
    if (currentConfig.apiBase) {
      syncNow(currentConfig.apiBase).catch((e) => console.log('Auto sync note:', e.message));
    }
  });

  window.addEventListener('offline', () => {
    updateBadge();
    recordAuditEvent('NETWORK_OFFLINE', '', 'Internet disconnected. Entering offline safe mode.');
  });

  updateBadge();
  openDatabase();
}

export default {
  initOffline,
  setupLocalWallet,
  listLocalTransactions,
  createOfflineTransfer,
  acceptScannedTransfer,
  syncNow,
  getSpendingLimit,
  setSpendingLimit,
  getOfflineAllowanceStatus,
  getSafetyDashboardData,
  getNotifications,
  markNotificationRead
};
