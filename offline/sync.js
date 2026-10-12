// sync.js - push pending transactions to the backend when internet returns
import { getPending, updateTxStatus } from './offlineStore.js';

// Expected backend contract (agree this with Person 2):
//   POST /api/sync  body: { transactions: [ {tx_id,sender,receiver,amount,timestamp,nonce,signature}, ... ] }
//   response:       { results: [ {tx_id, status: "accepted"|"duplicate"|"rejected", reason?: "..."} ] }
// "duplicate" means the server already applied this tx_id, so it is treated as confirmed.
// export async function syncPending(apiBase = '') {
//   if (!navigator.onLine) return { synced: 0, offline: true };
//   const pending = await getPending();
//   if (!pending.length) return { synced: 0 };

//   const transactions = pending.map(({ direction, status, reason, ...tx }) => tx);
//   const res = await fetch(`${apiBase}/api/sync`, {
//     method: 'POST',
//     headers: { 'Content-Type': 'application/json' },
//     body: JSON.stringify({ transactions }),
//   });
//   if (!res.ok) throw new Error(`Sync failed (${res.status})`);

//   const { results } = await res.json();
//   for (const r of results) {
//     const ok = r.status === 'accepted' || r.status === 'duplicate';
//     await updateTxStatus(r.tx_id, ok ? 'confirmed' : 'rejected', r.reason || '');
//   }
//   return { synced: results.length };
// }

export async function syncPending(apiBase = '') {
  if (!navigator.onLine) {
    return { synced: 0, offline: true };
  }

  const pending = await getPending();

  if (!pending.length) {
    return { synced: 0 };
  }

  const transactions = pending.map(
    ({ direction, status, reason, ...tx }) => tx
  );

  const res = await fetch(`${apiBase}/api/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transactions }),
  });

  if (!res.ok) {
    throw new Error(`Sync failed (${res.status})`);
  }

  const data = await res.json();

  if (!data || !Array.isArray(data.results)) {
    throw new Error('Invalid sync response: results array is missing.');
  }

  const pendingIds = new Set(pending.map((tx) => tx.tx_id));
  const seenResults = new Set();

  // Validate the entire response before changing any local statuses.
  for (const result of data.results) {
    if (
      !result ||
      typeof result.tx_id !== 'string' ||
      !pendingIds.has(result.tx_id) ||
      seenResults.has(result.tx_id) ||
      !['accepted', 'duplicate', 'rejected'].includes(result.status)
    ) {
      throw new Error('Invalid sync response: unexpected or duplicate result.');
    }

    seenResults.add(result.tx_id);
  }

  if (
    data.results.length !== pending.length ||
    seenResults.size !== pendingIds.size
  ) {
    throw new Error('Incomplete sync response. Transactions remain pending.');
  }

  for (const result of data.results) {
    if (result.status === 'accepted' || result.status === 'duplicate') {
      await updateTxStatus(result.tx_id, 'confirmed', '');
    } else {
      await updateTxStatus(
        result.tx_id,
        'rejected',
        result.reason || 'Backend rejected transaction.'
      );
    }
  }

  return { synced: data.results.length };
}


export function startAutoSync(apiBase = '', onDone = () => {}) {
  const attempt = () => syncPending(apiBase).then(onDone).catch(console.error);
  window.addEventListener('online', attempt);
  attempt();
}

export function bindOnlineBadge(el) {
  const paint = () => {
    el.textContent = navigator.onLine ? 'Online' : 'Offline';
    el.dataset.state = navigator.onLine ? 'online' : 'offline';
  };
  window.addEventListener('online', paint);
  window.addEventListener('offline', paint);
  paint();
}
