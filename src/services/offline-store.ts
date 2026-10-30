import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { TransactionRecord, QueuedOfflineTransaction, WalletState } from '../types/wallet.ts';

interface CoinPathDB extends DBSchema {
  wallet_cache: {
    key: string;
    value: WalletState;
  };
  transactions_cache: {
    key: string;
    value: TransactionRecord;
    indexes: { 'by-date': string };
  };
  offline_queue: {
    key: string;
    value: QueuedOfflineTransaction;
    indexes: { 'by-date': string };
  };
}

const DB_NAME = 'coinpath_offline_db';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<CoinPathDB>> | null = null;

function getDB(): Promise<IDBPDatabase<CoinPathDB>> {
  if (!dbPromise) {
    dbPromise = openDB<CoinPathDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('wallet_cache')) {
          db.createObjectStore('wallet_cache');
        }
        if (!db.objectStoreNames.contains('transactions_cache')) {
          const txStore = db.createObjectStore('transactions_cache', { keyPath: 'id' });
          txStore.createIndex('by-date', 'created_at');
        }
        if (!db.objectStoreNames.contains('offline_queue')) {
          const queueStore = db.createObjectStore('offline_queue', { keyPath: 'txId' });
          queueStore.createIndex('by-date', 'queuedAt');
        }
      },
    });
  }
  return dbPromise;
}

// -----------------------------------------------------------------------------
// Offline Queue Operations
// -----------------------------------------------------------------------------

export async function queueOfflineTransaction(tx: QueuedOfflineTransaction): Promise<void> {
  const db = await getDB();
  await db.put('offline_queue', tx);
}

export async function getQueuedTransactions(): Promise<QueuedOfflineTransaction[]> {
  const db = await getDB();
  return db.getAll('offline_queue');
}

export async function removeQueuedTransaction(txId: string): Promise<void> {
  const db = await getDB();
  await db.delete('offline_queue', txId);
}

export async function clearAllQueuedTransactions(): Promise<void> {
  const db = await getDB();
  await db.clear('offline_queue');
}

export async function getPendingOfflineCount(): Promise<number> {
  const db = await getDB();
  return db.count('offline_queue');
}

// -----------------------------------------------------------------------------
// Wallet State & Cache Operations
// -----------------------------------------------------------------------------

export async function setCachedWallet(walletId: string, wallet: WalletState): Promise<void> {
  const db = await getDB();
  await db.put('wallet_cache', wallet, walletId);
}

export async function getCachedWallet(walletId: string): Promise<WalletState | undefined> {
  const db = await getDB();
  return db.get('wallet_cache', walletId);
}

export async function setCachedTransactions(transactions: TransactionRecord[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('transactions_cache', 'readwrite');
  for (const record of transactions) {
    await tx.store.put(record);
  }
  await tx.done;
}

export async function getCachedTransactions(): Promise<TransactionRecord[]> {
  const db = await getDB();
  const txs = await db.getAll('transactions_cache');
  return txs.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

/**
 * Calculates conservative effective balance:
 * (Cached balance minus sum of pending offline queued transactions)
 */
export async function calculateConservativeBalance(baseBalance: number): Promise<number> {
  const queued = await getQueuedTransactions();
  const pendingTotal = queued.reduce((sum, item) => sum + item.amount, 0);
  return Math.max(0, baseBalance - pendingTotal);
}

/**
 * Safe local cache cleanup (does NOT delete offline queue unless specified)
 */
export async function purgeLocalCache(preservePendingQueue = true): Promise<void> {
  const db = await getDB();
  await db.clear('wallet_cache');
  await db.clear('transactions_cache');
  if (!preservePendingQueue) {
    await db.clear('offline_queue');
  }
}
