# CoinPath: Person 3 integration notes

## Transaction format (shared by everyone, do not change)
{ tx_id, sender, receiver, amount, timestamp, nonce, signature }
- tx_id: UUID string        - amount: positive whole number
- timestamp: milliseconds since 1970 (number)   - nonce: 32-char hex string

## Signature (what Person 2 needs to verify)
- Algorithm: ECDSA, curve P-256, hash SHA-256
- Signed message: the compact JSON array [tx_id, sender, receiver, amount, timestamp, nonce]
  as UTF-8 text, no spaces (identical to JavaScript JSON.stringify of that array)
- signature field: Base64 of the raw 64 bytes r||s (not DER; convert if the library needs DER)
- Public key: JWK object (fields kty, crv, x, y)

## For Person 1 (frontend)
Import from js/offlineApi.js:
- initOffline({apiBase, badgeEl, onSync})            call once at page load
- setupLocalWallet(walletId)                         returns public key JWK
- createOfflineTransfer(sender, receiver, amount)    returns {payload, tx}; payload = text for the QR
- acceptScannedTransfer(scannedText, myWalletId)     returns {ok, reason?, tx?}
- listLocalTransactions()                            for the history screen
- syncNow(apiBase)                                   for a "Sync now" button
Needs from Person 1: a QR generator (text in), a QR scanner (text out), an element for the
Online/Offline badge, and the QR library saved as a LOCAL file (not a CDN link) so it works offline.

## For Person 2 (backend)
Needs from Person 2:
1. POST /api/sync
   request : { "transactions": [ {tx_id, sender, receiver, amount, timestamp, nonce, signature}, ... ] }
   response: { "results": [ {"tx_id": "...", "status": "accepted" | "duplicate" | "rejected", "reason": "..."} ] }
   "duplicate" = already applied earlier (treated as confirmed). Must be safe to call twice.
2. A way to store each wallet's public key (JWK) and return it with the wallet data, e.g. a field
   public_key on GET /api/wallets. Phones download this while online.
3. A way to register the public key returned by setupLocalWallet().
