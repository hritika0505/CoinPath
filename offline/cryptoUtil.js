// cryptoUtil.js - key generation, signing, verification (Web Crypto, ECDSA P-256)
const ALGO = { name: 'ECDSA', namedCurve: 'P-256' };
const SIGN = { name: 'ECDSA', hash: 'SHA-256' };
const enc = new TextEncoder();

const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromB64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

export async function generateWalletKeys() {
  // extractable=false: the private key can be used but never exported
  const pair = await crypto.subtle.generateKey(ALGO, false, ['sign', 'verify']);
  const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  return { privateKey: pair.privateKey, publicJwk };
}

// Fixed field order => identical bytes on every device and on the server.
export function canonicalString(tx) {
  return JSON.stringify([tx.tx_id, tx.sender, tx.receiver, tx.amount, tx.timestamp, tx.nonce]);
}

export async function signTx(privateKey, tx) {
  const sig = await crypto.subtle.sign(SIGN, privateKey, enc.encode(canonicalString(tx)));
  return toB64(sig); // raw r||s, 64 bytes
}

export async function verifyTx(publicJwk, tx) {
  try {
    const key = await crypto.subtle.importKey('jwk', publicJwk, ALGO, false, ['verify']);
    return await crypto.subtle.verify(SIGN, key, fromB64(tx.signature), enc.encode(canonicalString(tx)));
  } catch {
    return false;
  }
}

export function newNonce() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}
