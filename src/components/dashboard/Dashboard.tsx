import React, { useState } from 'react';
import {
  Copy,
  Check,
  ArrowUpRight,
  ArrowDownLeft,
  QrCode,
  Clock,
  Sparkles,
  Wifi,
  WifiOff,
  RefreshCw,
  Coins,
  ChevronRight,
  ShieldCheck,
} from 'lucide-react';
import { UserProfile, WalletState, TransactionRecord, PendingIncomingTransfer } from '../../types/wallet.ts';
import { TabType } from '../common/BottomNav.tsx';

interface DashboardProps {
  user: UserProfile;
  wallet: WalletState;
  conservativeBalance: number;
  recentTransactions: TransactionRecord[];
  isOnline: boolean;
  pendingCount: number;
  incomingPendingTransfers?: PendingIncomingTransfer[];
  incomingPendingTotal?: number;
  onNavigateTab: (tab: TabType) => void;
  onOpenScanner?: () => void;
  onRequestFaucet: () => void;
  onSyncNow: () => void;
  isSyncing?: boolean;
}

export const Dashboard: React.FC<DashboardProps> = ({
  user,
  wallet,
  conservativeBalance,
  recentTransactions,
  isOnline,
  pendingCount,
  incomingPendingTransfers = [],
  incomingPendingTotal = 0,
  onNavigateTab,
  onOpenScanner,
  onRequestFaucet,
  onSyncNow,
  isSyncing = false,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopyWalletId = () => {
    navigator.clipboard.writeText(wallet.walletId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const hasOfflineDeduction = wallet.balance !== conservativeBalance;

  return (
    <div className="space-y-5 pb-8">
      {/* Welcome Banner */}
      <div className="flex items-center justify-between">
        <div>
          <span className="text-xs text-slate-400">Welcome back,</span>
          <h2 className="text-xl font-bold text-white tracking-tight">{user.fullName}</h2>
        </div>
        <div className="text-right">
          <span className="text-[11px] text-slate-400">Username</span>
          <div className="text-xs font-semibold text-blue-400 font-mono">@{user.username}</div>
        </div>
      </div>

      {/* Main Virtual Balance Card */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-blue-900 via-slate-900 to-[#080e1e] border border-blue-800/50 p-6 shadow-2xl">
        <div className="absolute -top-12 -right-12 w-40 h-40 bg-blue-500/10 rounded-full blur-2xl pointer-events-none" />

        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-xs text-blue-300 font-medium">
            <Coins className="w-4 h-4 text-cyan-400" />
            <span>Virtual Coin Balance</span>
          </div>

          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-slate-950/60 border border-slate-800 text-[11px]">
            {isOnline ? (
              <span className="text-emerald-400 flex items-center gap-1 font-medium">
                <Wifi className="w-3 h-3" /> Live
              </span>
            ) : (
              <span className="text-amber-400 flex items-center gap-1 font-medium">
                <WifiOff className="w-3 h-3" /> Offline
              </span>
            )}
          </div>
        </div>

        {/* Large Balance Display */}
        <div className="space-y-1 mb-5">
          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-extrabold text-white tracking-tight font-mono tabular-nums">
              {conservativeBalance.toLocaleString()}
            </span>
            <span className="text-sm font-semibold text-cyan-400">COINS</span>
          </div>

          {hasOfflineDeduction && (
            <p className="text-xs text-amber-300/90 flex items-center gap-1 font-medium">
              <span>Server balance: {wallet.balance.toLocaleString()}</span>
              <span>·</span>
              <span>({wallet.balance - conservativeBalance} queued offline)</span>
            </p>
          )}

          <div className="flex items-center gap-2 pt-1 text-[11px] text-slate-400">
            <span>Tx Limit: <strong>{wallet.maxTxLimit} coins</strong>/tx</span>
            <span aria-hidden="true">·</span>
            <span className="text-slate-400">Educational Simulation</span>
          </div>
        </div>

        {/* Wallet ID Pill with 1-Click Copy */}
        <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between">
          <div className="flex flex-col">
            <span className="text-[10px] text-slate-400 uppercase tracking-wider">Your Wallet ID</span>
            <span className="text-xs font-mono font-semibold text-slate-200 tracking-wide">
              {wallet.walletId}
            </span>
          </div>

          <button
            onClick={handleCopyWalletId}
            className="min-h-[40px] px-3 py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 text-xs text-blue-300 hover:text-white flex items-center gap-1.5 transition-colors border border-slate-700/70"
            title="Copy Wallet ID to Clipboard"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-emerald-400 font-medium">Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>Copy</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Primary Action Buttons (Thumb zone) */}
      <div className="grid grid-cols-3 gap-3">
        <button
          onClick={() => onNavigateTab('send')}
          className="min-h-[56px] flex flex-col items-center justify-center p-3 rounded-2xl bg-[#0f172a] hover:bg-slate-800 border border-slate-800 hover:border-blue-500/50 transition-all text-white group"
        >
          <div className="w-8 h-8 rounded-xl bg-blue-600/20 text-blue-400 flex items-center justify-center mb-1 group-hover:scale-110 transition-transform">
            <ArrowUpRight className="w-4 h-4" />
          </div>
          <span className="text-xs font-semibold">Send</span>
        </button>

        <button
          onClick={() => onNavigateTab('receive')}
          className="min-h-[56px] flex flex-col items-center justify-center p-3 rounded-2xl bg-[#0f172a] hover:bg-slate-800 border border-slate-800 hover:border-emerald-500/50 transition-all text-white group"
        >
          <div className="w-8 h-8 rounded-xl bg-emerald-600/20 text-emerald-400 flex items-center justify-center mb-1 group-hover:scale-110 transition-transform">
            <ArrowDownLeft className="w-4 h-4" />
          </div>
          <span className="text-xs font-semibold">Receive</span>
        </button>

        <button
          onClick={() => {
            if (onOpenScanner) onOpenScanner();
            else onNavigateTab('send');
          }}
          className="min-h-[56px] flex flex-col items-center justify-center p-3 rounded-2xl bg-[#0f172a] hover:bg-slate-800 border border-slate-800 hover:border-cyan-500/50 transition-all text-white group"
        >
          <div className="w-8 h-8 rounded-xl bg-cyan-600/20 text-cyan-400 flex items-center justify-center mb-1 group-hover:scale-110 transition-transform">
            <QrCode className="w-4 h-4" />
          </div>
          <span className="text-xs font-semibold">Scan QR</span>
        </button>
      </div>

      {/* Incoming Pending Vouchers Alert (When receiver has scanned an offline voucher) */}
      {incomingPendingTotal > 0 && (
        <div className="p-4 rounded-2xl bg-cyan-950/40 border border-cyan-800/60 flex items-center justify-between shadow-xl">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-cyan-600/20 text-cyan-400 flex items-center justify-center">
              <ArrowDownLeft className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs font-bold text-cyan-200">
                +{incomingPendingTotal} Coins Incoming ({incomingPendingTransfers.length} {incomingPendingTransfers.length === 1 ? 'Voucher' : 'Vouchers'})
              </div>
              <p className="text-[11px] text-cyan-300/80">
                {isOnline
                  ? 'Ready to sync: Click Sync Now to credit your ledger!'
                  : 'Offline voucher registered: Coins will settle upon sync.'}
              </p>
            </div>
          </div>

          <button
            onClick={onSyncNow}
            disabled={!isOnline || isSyncing}
            className="min-h-[40px] px-3 py-1.5 bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 text-slate-950 font-bold text-xs rounded-xl transition-colors cursor-pointer"
          >
            {isSyncing ? 'Syncing...' : 'Sync Now'}
          </button>
        </div>
      )}

      {/* Pending Sync Card if offline transactions exist */}
      {pendingCount > 0 && (
        <div className="p-4 rounded-2xl bg-amber-950/30 border border-amber-800/60 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-600/20 text-amber-400 flex items-center justify-center">
              <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
            </div>
            <div>
              <div className="text-xs font-bold text-amber-200">
                {pendingCount} Queued Offline {pendingCount === 1 ? 'Transfer' : 'Transfers'}
              </div>
              <p className="text-[11px] text-amber-400/80">
                {isOnline ? 'Ready to sync with server ledger' : 'Will sync automatically when back online'}
              </p>
            </div>
          </div>

          <button
            onClick={onSyncNow}
            disabled={!isOnline || isSyncing}
            className="min-h-[40px] px-3 py-1.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-slate-950 font-bold text-xs rounded-xl transition-colors cursor-pointer"
          >
            {isSyncing ? 'Syncing...' : 'Sync Now'}
          </button>
        </div>
      )}

      {/* Safety Faucet for Testing */}
      <div className="p-3.5 rounded-2xl bg-slate-900/60 border border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2.5 text-xs text-slate-300">
          <Sparkles className="w-4 h-4 text-cyan-400" />
          <div>
            <span className="font-medium text-white">Need test coins?</span>
            <p className="text-[11px] text-slate-400">Provision 50 virtual test coins from reserve</p>
          </div>
        </div>

        <button
          onClick={onRequestFaucet}
          disabled={!isOnline}
          className="min-h-[40px] px-3 py-1 text-xs font-medium rounded-xl bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 transition-colors disabled:opacity-40"
        >
          +50 Test Coins
        </button>
      </div>

      {/* Recent Transactions Section */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
            <Clock className="w-4 h-4 text-slate-400" />
            Recent Activity
          </h3>
          <button
            onClick={() => onNavigateTab('history')}
            className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-0.5 font-medium transition-colors"
          >
            <span>View All</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {recentTransactions.length === 0 ? (
          <div className="p-6 text-center rounded-2xl bg-slate-900/40 border border-slate-800/80">
            <p className="text-xs text-slate-400">No transactions recorded yet.</p>
            <p className="text-[11px] text-slate-500 mt-1">Send or receive coins using your wallet ID or QR code.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {recentTransactions.slice(0, 5).map((tx) => {
              const isSent = tx.sender_wallet_id === wallet.walletId;
              const isPending = tx.status === 'pending_sync';
              const isRejected = tx.status === 'rejected';

              return (
                <div
                  key={tx.id}
                  onClick={() => onNavigateTab('history')}
                  className="min-h-[56px] p-3 rounded-2xl bg-[#0f172a] hover:bg-slate-800/70 border border-slate-800 flex items-center justify-between transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                        isPending
                          ? 'bg-amber-600/20 text-amber-400'
                          : isRejected
                          ? 'bg-rose-600/20 text-rose-400'
                          : isSent
                          ? 'bg-blue-600/20 text-blue-400'
                          : 'bg-emerald-600/20 text-emerald-400'
                      }`}
                    >
                      {isSent ? (
                        <ArrowUpRight className="w-4 h-4" />
                      ) : (
                        <ArrowDownLeft className="w-4 h-4" />
                      )}
                    </div>

                    <div>
                      <div className="text-xs font-semibold text-white">
                        {isSent ? `To ${tx.receiver_wallet_id}` : `From ${tx.sender_wallet_id}`}
                      </div>
                      <div className="text-[11px] text-slate-400 flex items-center gap-1.5">
                        <span>{new Date(tx.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        <span>·</span>
                        <span
                          className={
                            isPending
                              ? 'text-amber-400'
                              : isRejected
                              ? 'text-rose-400'
                              : 'text-emerald-400'
                          }
                        >
                          {isPending ? 'Queued Offline' : isRejected ? 'Rejected' : 'Accepted'}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="text-right">
                    <div
                      className={`text-sm font-bold font-mono tabular-nums ${
                        isSent ? 'text-slate-200' : 'text-emerald-400'
                      }`}
                    >
                      {isSent ? `-${tx.amount}` : `+${tx.amount}`}
                    </div>
                    <div className="text-[10px] text-slate-400 uppercase">coins</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Security note */}
      <div className="p-3 rounded-xl bg-slate-900/30 border border-slate-800/60 flex items-center gap-2 text-xs text-slate-400">
        <ShieldCheck className="w-4 h-4 text-blue-400 shrink-0" />
        <span>Atomic database transactions with replay protection & signature validation.</span>
      </div>
    </div>
  );
};
