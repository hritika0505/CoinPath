// offlineApi.js - the ONLY file your teammates need to import.
// It wraps storage, signing, transfer checks and sync behind a few simple functions.
import { generateWalletKeys } from './cryptoUtil.js';
import { saveKeys, saveWallet, getKeys, getAllTx } from './offlineStore.js';
import { sendTransaction, receiveTransaction } from './transfer.js';
import { startAutoSync, bindOnlineBadge, syncPending } from './sync.js';

// Call once when the app loads.
//   badgeEl : optional element that will show "Online" / "Offline"
//   apiBase : backend address, e.g. "http://192.168.1.5:8000" ('' = same origin)
//   onSync  : called after each automatic sync so the UI can refresh
export async function initOffline({ apiBase = '', badgeEl = null, onSync = () => {} } = {}) {
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('./sw.js');
    } catch (e) {
      console.error('Service worker registration failed', e);
    }
  }
  if (badgeEl) bindOnlineBadge(badgeEl);
  startAutoSync(apiBase, onSync);
}

// Creates this device's signing keys for a wallet (only once).
// Returns the PUBLIC key (JWK object) that must be registered with the backend.
export async function setupLocalWallet(walletId) {
  const existing = await getKeys(walletId);
  if (existing) return existing.publicJwk;
  const k = await generateWalletKeys();
  await saveKeys(walletId, k.privateKey, k.publicJwk);
  return k.publicJwk;
}

// Stores wallets (id, balance, public_key) downloaded from the backend while online.
// Needed so a receiver can verify a sender's signature with no internet.
export async function cacheWallets(wallets) {
  for (const w of wallets) {
    await saveWallet({ wallet_id: w.wallet_id, balance: w.balance, public_key: w.public_key });
  }
}

// Sender: returns the text to turn into a QR code. Throws Error(message) on a rule violation.
export async function createOfflineTransfer(senderId, receiverId, amount) {
  const { payload, tx } = await sendTransaction(senderId, receiverId, Number(amount));
  return { payload, tx };
}

// Receiver: pass the text scanned from the QR. Returns {ok:true, tx} or {ok:false, reason}.
export function acceptScannedTransfer(scannedText, myWalletId) {
  return receiveTransaction(scannedText, myWalletId);
}

// Locally stored transactions, newest first. status: pending_sync | confirmed | rejected
export async function listLocalTransactions() {
  const all = await getAllTx();
  return all.sort((a, b) => b.timestamp - a.timestamp);
}

// Force a sync (e.g. a "Sync now" button).
export const syncNow = (apiBase = '') => syncPending(apiBase);
