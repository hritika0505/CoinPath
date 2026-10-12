// transfer.js - create (sender side) and accept (receiver side) offline transactions
import { signTx, verifyTx, newNonce } from './cryptoUtil.js';
import { savePending, getAllTx, markSeen, hasSeen, getWallet, getKeys } from './offlineStore.js';

export const OFFLINE_CAP = 200;            // max total coins sendable while unsynced
export const MAX_AGE_MS = 60 * 60 * 1000;  // reject transactions older than 1 hour

// Pure: builds and signs a transaction. Does not touch storage.
export async function buildSignedTx({ sender, receiver, amount, privateKey, timestamp }) {
  const tx = {
    tx_id: crypto.randomUUID(),
    sender,
    receiver,
    amount,
    timestamp: timestamp ?? Date.now(),
    nonce: newNonce(),
  };
  tx.signature = await signTx(privateKey, tx);
  return tx;
}

// Sender side: checks limits, signs, stores as pending, returns QR payload text.
export async function sendTransaction(sender, receiver, amount) {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('Amount must be a positive whole number');
  if (sender === receiver) throw new Error('Cannot send to yourself');

  const keys = await getKeys(sender);
  if (!keys) throw new Error('No signing key for this wallet');

  const all = await getAllTx();
  const pendingOut = all
    .filter((t) => t.sender === sender && t.direction === 'outgoing' && t.status === 'pending_sync')
    .reduce((sum, t) => sum + t.amount, 0);

  if (pendingOut + amount > OFFLINE_CAP) throw new Error(`Offline limit of ${OFFLINE_CAP} coins reached`);
  const wallet = await getWallet(sender);
  if (wallet && pendingOut + amount > wallet.balance) throw new Error('Insufficient balance');

  const tx = await buildSignedTx({ sender, receiver, amount, privateKey: keys.privateKey });
  await savePending({ ...tx, direction: 'outgoing', status: 'pending_sync' });
  return { tx, payload: JSON.stringify(tx) };
}

// Receiver side: validates scanned QR text. Returns {ok, reason?, tx?}
export async function receiveTransaction(payload, myWalletId) {
  let tx;
  try { tx = JSON.parse(payload); } catch { return { ok: false, reason: 'malformed' }; }

  const okShape =
    tx && typeof tx.tx_id === 'string' && typeof tx.sender === 'string' &&
    typeof tx.receiver === 'string' && typeof tx.nonce === 'string' &&
    typeof tx.signature === 'string' && Number.isInteger(tx.amount) &&
    tx.amount > 0 && Number.isFinite(tx.timestamp);
  if (!okShape) return { ok: false, reason: 'malformed' };

  if (tx.receiver !== myWalletId) return { ok: false, reason: 'wrong_receiver' };
  if (Math.abs(Date.now() - tx.timestamp) > MAX_AGE_MS) return { ok: false, reason: 'expired' };
  if (await hasSeen(tx.tx_id)) return { ok: false, reason: 'duplicate' };

  const senderWallet = await getWallet(tx.sender);
  if (!senderWallet || !senderWallet.public_key) return { ok: false, reason: 'unknown_sender' };

  const valid = await verifyTx(senderWallet.public_key, tx);
  if (!valid) return { ok: false, reason: 'bad_signature' };

  await markSeen(tx.tx_id);
  await savePending({ ...tx, direction: 'incoming', status: 'pending_sync' });
  return { ok: true, tx };
}
