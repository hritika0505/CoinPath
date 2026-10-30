/**
 * P-256 ECDSA Cryptographic Service for CoinPath
 * Uses browser Web Crypto API (SubtleCrypto)
 */

const KEY_STORAGE_PREFIX = 'coinpath_p256_';

// ArrayBuffer to Hex helper
export function bufToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ArrayBuffer to Base64 helper
export function bufToBase64(buffer: ArrayBuffer): string {
  const binary = String.fromCharCode(...new Uint8Array(buffer));
  return window.btoa(binary);
}

// Base64 to ArrayBuffer helper
export function base64ToBuf(base64: string): ArrayBuffer {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export interface GeneratedKeyData {
  publicKeySpkiBase64: string;
  privateKeyJwk: JsonWebKey;
}

/**
 * Generate new P-256 ECDSA key pair
 */
export async function generateP256KeyPair(): Promise<GeneratedKeyData> {
  const keyPair = await window.crypto.subtle.generateKey(
    {
      name: 'ECDSA',
      namedCurve: 'P-256',
    },
    true, // extractable
    ['sign', 'verify']
  );

  const spki = await window.crypto.subtle.exportKey('spki', keyPair.publicKey);
  const publicKeySpkiBase64 = bufToBase64(spki);
  const privateKeyJwk = await window.crypto.subtle.exportKey('jwk', keyPair.privateKey);

  return {
    publicKeySpkiBase64,
    privateKeyJwk,
  };
}

/**
 * Save private key JWK securely in localStorage scoped to username
 */
export function savePrivateKey(username: string, jwk: JsonWebKey) {
  try {
    localStorage.setItem(`${KEY_STORAGE_PREFIX}${username.toLowerCase()}`, JSON.stringify(jwk));
  } catch (err) {
    console.warn('Failed to save private key in storage:', err);
  }
}

/**
 * Get private key JWK from localStorage
 */
export function getSavedPrivateKey(username: string): JsonWebKey | null {
  try {
    const raw = localStorage.getItem(`${KEY_STORAGE_PREFIX}${username.toLowerCase()}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Sign transaction payload using P-256 private key with SHA-256
 */
export async function signTransactionPayload(
  privateKeyJwk: JsonWebKey,
  payload: {
    senderWalletId: string;
    receiverWalletId: string;
    amount: number;
    nonce: string;
  }
): Promise<string> {
  const privateKey = await window.crypto.subtle.importKey(
    'jwk',
    privateKeyJwk,
    {
      name: 'ECDSA',
      namedCurve: 'P-256',
    },
    false,
    ['sign']
  );

  const dataStr = JSON.stringify(payload);
  const encoded = new TextEncoder().encode(dataStr);

  const signatureBuffer = await window.crypto.subtle.sign(
    {
      name: 'ECDSA',
      hash: { name: 'SHA-256' },
    },
    privateKey,
    encoded
  );

  return bufToHex(signatureBuffer);
}
