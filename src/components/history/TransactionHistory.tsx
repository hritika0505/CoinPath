import React, { useState } from 'react';
import {
  ArrowUpRight,
  ArrowDownLeft,
  Search,
  Clock,
  CheckCircle2,
  XCircle,
  X,
  ShieldCheck,
  RefreshCw,
} from 'lucide-react';
import { TransactionRecord, QueuedOfflineTransaction, PendingIncomingTransfer, WalletState } from '../../types/wallet.ts';

interface TransactionHistoryProps {
  wallet: WalletState;
  transactions: TransactionRecord[];
  queuedTransactions: QueuedOfflineTransaction[];
  incomingPendingTransfers?: PendingIncomingTransfer[];
  isLoading: boolean;
  onRefresh: () => void;
}

export const TransactionHistory: React.FC<TransactionHistoryProps> = ({
  wallet,
  transactions,
  queuedTransactions,
  incomingPendingTransfers = [],
  isLoading,
  onRefresh,
}) => {
  const [filter, setFilter] = useState<'all' | 'sent' | 'received' | 'pending' | 'rejected'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTx, setSelectedTx] = useState<TransactionRecord | null>(null);

  // Merge queued offline transactions as synthetic pending records
  const syntheticPendingRecords: TransactionRecord[] = queuedTransactions.map((q) => ({
    id: q.txId,
    nonce: q.nonce,
    sender_wallet_id: wallet.walletId,
    receiver_wallet_id: q.receiverWalletId,
    amount: q.amount,
    status: 'pending_sync',
    sync_status: 'queued_offline',
    signature: q.signature || null,
    error_reason: null,
    created_at: q.queuedAt,
  }));

  // Merge incoming pending vouchers as synthetic records
  const syntheticIncomingRecords: TransactionRecord[] = incomingPendingTransfers.map((inc) => ({
    id: inc.txId,
    nonce: inc.nonce,
    sender_wallet_id: inc.senderWalletId,
    receiver_wallet_id: inc.receiverWalletId,
    amount: inc.amount,
    status: 'pending_sync',
    sync_status: 'queued_offline',
    signature: inc.signature || null,
    error_reason: null,
    created_at: inc.receivedAt,
  }));

  // Combine unique by id
  const existingIds = new Set(transactions.map((t) => t.id));
  const combined = [
    ...syntheticPendingRecords.filter((p) => !existingIds.has(p.id)),
    ...syntheticIncomingRecords.filter((p) => !existingIds.has(p.id)),
    ...transactions,
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  // Apply filters
  const filtered = combined.filter((tx) => {
    const isSent = tx.sender_wallet_id === wallet.walletId;

    if (filter === 'sent' && !isSent) return false;
    if (filter === 'received' && isSent) return false;
    if (filter === 'pending' && tx.status !== 'pending_sync') return false;
    if (filter === 'rejected' && tx.status !== 'rejected') return false;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        tx.id.toLowerCase().includes(q) ||
        tx.receiver_wallet_id.toLowerCase().includes(q) ||
        tx.sender_wallet_id.toLowerCase().includes(q)
      );
    }

    return true;
  });

  return (
    <div className="space-y-4 pb-8">
      {/* Title & Refresh */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">Ledger & History</h2>
          <p className="text-xs text-slate-400">Auditable virtual transaction records</p>
        </div>

        <button
          onClick={onRefresh}
          disabled={isLoading}
          className="min-h-[40px] px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-300 flex items-center gap-1.5 transition-colors border border-slate-700 cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Search Input */}
      <div className="relative">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
          <Search className="w-4 h-4" />
        </div>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search by Tx ID or wallet address..."
          className="w-full pl-9 pr-3 py-2 bg-[#0f172a] border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
        />
      </div>

      {/* Interactive Filter Tabs */}
      <div className="flex items-center gap-1 p-1 bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto">
        {(['all', 'sent', 'received', 'pending', 'rejected'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setFilter(tab)}
            className={`min-h-[36px] px-3 py-1 text-xs font-semibold rounded-lg capitalize whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
              filter === tab
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Transactions List */}
      {filtered.length === 0 ? (
        <div className="p-8 text-center rounded-2xl bg-[#0f172a] border border-slate-800">
          <Clock className="w-8 h-8 text-slate-500 mx-auto mb-2" />
          <p className="text-xs text-slate-300 font-semibold">No transactions found</p>
          <p className="text-[11px] text-slate-500 mt-1">
            {searchQuery ? 'Try matching a different address or ID.' : 'Make a transfer or scan a QR code to begin.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((tx) => {
            const isSent = tx.sender_wallet_id === wallet.walletId;
            const isPending = tx.status === 'pending_sync';
            const isRejected = tx.status === 'rejected';

            return (
              <div
                key={tx.id}
                onClick={() => setSelectedTx(tx)}
                className="min-h-[58px] p-3 rounded-2xl bg-[#0f172a] hover:bg-slate-800/80 border border-slate-800 flex items-center justify-between transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                      isPending
                        ? 'bg-amber-600/20 text-amber-400'
                        : isRejected
                        ? 'bg-rose-600/20 text-rose-400'
                        : isSent
                        ? 'bg-blue-600/20 text-blue-400'
                        : 'bg-emerald-600/20 text-emerald-400'
                    }`}
                  >
                    {isPending ? (
                      <Clock className="w-4 h-4" />
                    ) : isRejected ? (
                      <XCircle className="w-4 h-4" />
                    ) : isSent ? (
                      <ArrowUpRight className="w-4 h-4" />
                    ) : (
                      <ArrowDownLeft className="w-4 h-4" />
                    )}
                  </div>

                  <div>
                    <div className="text-xs font-semibold text-white">
                      {isSent ? `To ${tx.receiver_wallet_id}` : `From ${tx.sender_wallet_id}`}
                    </div>
                    <div className="text-[11px] text-slate-400 flex items-center gap-1.5 mt-0.5">
                      <span>{new Date(tx.created_at).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                      <span>·</span>
                      <span
                        className={
                          isPending
                            ? isSent
                              ? 'text-amber-400 font-medium'
                              : 'text-cyan-400 font-medium'
                            : isRejected
                            ? 'text-rose-400 font-medium'
                            : 'text-emerald-400 font-medium'
                        }
                      >
                        {isPending
                          ? isSent
                            ? 'Queued Offline'
                            : 'Incoming Voucher (Pending Sync)'
                          : isRejected
                          ? 'Rejected'
                          : 'Accepted'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="text-right">
                  <div
                    className={`text-sm font-bold font-mono tabular-nums ${
                      isPending && !isSent
                        ? 'text-cyan-400'
                        : isSent
                        ? 'text-slate-200'
                        : 'text-emerald-400'
                    }`}
                  >
                    {isSent ? `-${tx.amount}` : isPending ? `+${tx.amount} (Pending)` : `+${tx.amount}`}
                  </div>
                  <div className="text-[10px] text-slate-400 font-mono">{tx.id.substring(0, 10)}...</div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Transaction Detail Modal */}
      {selectedTx && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-[#0f172a] border border-slate-700 rounded-3xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-blue-400" />
                <h3 className="text-base font-bold text-white">Transaction Details</h3>
              </div>
              <button
                onClick={() => setSelectedTx(null)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-full bg-slate-800 text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2.5 text-xs">
              <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 space-y-1">
                <span className="text-slate-400">Transaction ID:</span>
                <div className="font-mono text-white text-[11px] break-all">{selectedTx.id}</div>
              </div>

              <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 flex justify-between">
                <span className="text-slate-400">Direction:</span>
                <span className="font-semibold text-white">
                  {selectedTx.sender_wallet_id === wallet.walletId ? 'Sent' : 'Received'}
                </span>
              </div>

              <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 flex justify-between">
                <span className="text-slate-400">Amount:</span>
                <span className="font-mono font-bold text-emerald-400 text-sm">
                  {selectedTx.amount} Virtual Coins
                </span>
              </div>

              <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 flex justify-between">
                <span className="text-slate-400">Sender Wallet:</span>
                <span className="font-mono text-white">{selectedTx.sender_wallet_id}</span>
              </div>

              <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 flex justify-between">
                <span className="text-slate-400">Receiver Wallet:</span>
                <span className="font-mono text-white">{selectedTx.receiver_wallet_id}</span>
              </div>

              <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 flex justify-between">
                <span className="text-slate-400">Timestamp:</span>
                <span className="text-slate-200">
                  {new Date(selectedTx.created_at).toLocaleString()}
                </span>
              </div>

              <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 flex justify-between">
                <span className="text-slate-400">Execution Status:</span>
                <span
                  className={`font-semibold ${
                    selectedTx.status === 'accepted'
                      ? 'text-emerald-400'
                      : selectedTx.status === 'pending_sync'
                      ? 'text-amber-400'
                      : 'text-rose-400'
                  }`}
                >
                  {selectedTx.status.toUpperCase()}
                </span>
              </div>

              <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 flex justify-between">
                <span className="text-slate-400">Sync Status:</span>
                <span className="text-slate-300 font-mono text-[11px]">
                  {selectedTx.sync_status}
                </span>
              </div>

              {selectedTx.error_reason && (
                <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-900/60 text-rose-300">
                  <span className="font-semibold block mb-0.5">Rejection Reason:</span>
                  {selectedTx.error_reason}
                </div>
              )}

              {selectedTx.signature && (
                <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 space-y-1">
                  <span className="text-slate-400">ECDSA P-256 Signature:</span>
                  <div className="font-mono text-[10px] text-cyan-400 break-all">
                    {selectedTx.signature}
                  </div>
                </div>
              )}
            </div>

            <button
              onClick={() => setSelectedTx(null)}
              className="w-full h-11 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-semibold text-xs transition-colors cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
