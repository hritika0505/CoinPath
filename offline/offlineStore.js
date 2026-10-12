// offlineStore.js - local storage layer (IndexedDB) for CoinPath
// Stores: pending_tx, seen_ids, wallet_cache, keys
const DB_NAME = 'coinpath-db';
const DB_VERSION = 1;
let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('pending_tx')) db.createObjectStore('pending_tx', { keyPath: 'tx_id' });
      if (!db.objectStoreNames.contains('seen_ids')) db.createObjectStore('seen_ids', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('wallet_cache')) db.createObjectStore('wallet_cache', { keyPath: 'wallet_id' });
      if (!db.objectStoreNames.contains('keys')) db.createObjectStore('keys', { keyPath: 'wallet_id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function run(storeName, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeName, mode);
    const req = fn(t.objectStore(storeName));
    t.oncomplete = () => resolve(req ? req.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

// ---- pending transactions ----
export const savePending = (rec) => run('pending_tx', 'readwrite', (s) => s.put(rec));
export const getAllTx = () => run('pending_tx', 'readonly', (s) => s.getAll());
export async function getPending() {
  return (await getAllTx()).filter((t) => t.status === 'pending_sync');
}

export async function updateTxStatus(tx_id, status, reason = '') {
  const allowedStatuses = ['pending_sync', 'confirmed', 'rejected'];

  if (!allowedStatuses.includes(status)) {
    throw new Error('Invalid transaction status');
  }

  const rec = await run('pending_tx', 'readonly', (s) => s.get(tx_id));
  if (!rec) return;

  // Do not downgrade an already confirmed transaction.
  if (rec.status === 'confirmed' && status !== 'confirmed') {
    return;
  }

  rec.status = status;
  rec.reason = reason;

  await savePending(rec);
}


// ---- duplicate detection ----
export const markSeen = (id) => run('seen_ids', 'readwrite', (s) => s.put({ id, at: Date.now() }));
export async function hasSeen(id) {
  return (await run('seen_ids', 'readonly', (s) => s.get(id))) !== undefined;
}

// ---- wallet cache: {wallet_id, balance, public_key(JWK)} ----
export const saveWallet = (w) => run('wallet_cache', 'readwrite', (s) => s.put(w));
export const getWallet = (id) => run('wallet_cache', 'readonly', (s) => s.get(id));

// ---- own signing keys ----
export const saveKeys = (wallet_id, privateKey, publicJwk) =>
  run('keys', 'readwrite', (s) => s.put({ wallet_id, privateKey, publicJwk }));
export const getKeys = (id) => run('keys', 'readonly', (s) => s.get(id));

// ---- testing helper ----
export async function clearAll() {
  for (const n of ['pending_tx', 'seen_ids', 'wallet_cache', 'keys']) {
    await run(n, 'readwrite', (s) => s.clear());
  }
}

