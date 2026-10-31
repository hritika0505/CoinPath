export interface UserProfile {
  id: number;
  username: string;
  email: string;
  fullName: string;
  walletId: string;
  publicKey?: string | null;
}

export interface WalletState {
  walletId: string;
  balance: number;
  maxTxLimit: number;
  updatedAt?: string;
}

export type TransactionStatus = 'accepted' | 'rejected' | 'pending_sync';
export type SyncStatus = 'online_direct' | 'synced_offline' | 'queued_offline' | 'failed';

export interface TransactionRecord {
  id: string;
  nonce: string;
  sender_wallet_id: string;
  receiver_wallet_id: string;
  amount: number;
  status: TransactionStatus;
  sync_status: SyncStatus;
  signature?: string | null;
  error_reason?: string | null;
  created_at: string;
}

export interface QueuedOfflineTransaction {
  txId: string;
  senderWalletId?: string;
  receiverWalletId: string;
  receiverName?: string;
  amount: number;
  nonce: string;
  signature?: string;
  queuedAt: string;
  status: 'pending_sync';
}

export interface PendingIncomingTransfer {
  txId: string;
  senderWalletId: string;
  senderName?: string;
  receiverWalletId: string;
  amount: number;
  nonce: string;
  signature?: string;
  receivedAt: string;
  status: 'pending_incoming';
}

export interface ReceiveQrPayload {
  type: 'coinpath_receive';
  version: 1;
  walletId: string;
  username?: string;
}

// Payment transfer receipt / voucher payload when sender shows receipt to receiver
export interface OfflinePaymentVoucherPayload {
  type: 'coinpath_payment_voucher';
  version: 1;
  txId: string;
  senderWalletId: string;
  senderName?: string;
  receiverWalletId: string;
  amount: number;
  nonce: string;
  signature?: string;
  timestamp: string;
}
