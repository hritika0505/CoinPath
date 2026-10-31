import React, { useState, useEffect, useCallback } from 'react';
import { Header } from './components/common/Header.tsx';
import { BottomNav, TabType } from './components/common/BottomNav.tsx';
import { ToastContainer, ToastMessage } from './components/common/Toast.tsx';
import { AuthScreens } from './components/auth/AuthScreens.tsx';
import { Dashboard } from './components/dashboard/Dashboard.tsx';
import { SendCoins } from './components/transfer/SendCoins.tsx';
import { ReceiveCoins } from './components/receive/ReceiveCoins.tsx';
import { TransactionHistory } from './components/history/TransactionHistory.tsx';
import { ProfileSettings } from './components/profile/ProfileSettings.tsx';
import { AndroidGuideModal } from './components/android/AndroidGuideModal.tsx';

import { UserProfile, WalletState, TransactionRecord, QueuedOfflineTransaction, PendingIncomingTransfer, OfflinePaymentVoucherPayload } from './types/wallet.ts';
import { apiRequest, getStoredToken, setStoredToken } from './services/api.ts';
import { networkMonitor } from './services/network.ts';
import {
  getCachedWallet,
  setCachedWallet,
  getCachedTransactions,
  setCachedTransactions,
  getQueuedTransactions,
  removeQueuedTransaction,
  getPendingOfflineCount,
  calculateConservativeBalance,
  getIncomingPendingTransfers,
  removeIncomingPendingTransfer,
  recordIncomingPendingTransfer,
  calculateIncomingPendingTotal,
} from './services/offline-store.ts';

export default function App() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [wallet, setWallet] = useState<WalletState | null>(null);
  const [conservativeBalance, setConservativeBalance] = useState<number>(0);
  const [recentTransactions, setRecentTransactions] = useState<TransactionRecord[]>([]);
  const [queuedTransactions, setQueuedTransactions] = useState<QueuedOfflineTransaction[]>([]);
  const [incomingPendingTransfers, setIncomingPendingTransfers] = useState<PendingIncomingTransfer[]>([]);
  const [incomingPendingTotal, setIncomingPendingTotal] = useState<number>(0);
  const [pendingCount, setPendingCount] = useState<number>(0);

  const [currentTab, setCurrentTab] = useState<TabType>('dashboard');
  const [isOnline, setIsOnline] = useState<boolean>(networkMonitor.isOnline());
  const [isInitialLoading, setIsInitialLoading] = useState<boolean>(true);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [isHistoryLoading, setIsHistoryLoading] = useState<boolean>(false);

  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [showAndroidGuide, setShowAndroidGuide] = useState<boolean>(false);
  const [openScannerOnSend, setOpenScannerOnSend] = useState<boolean>(false);

  // Toast notification helper
  const showToast = useCallback(
    (type: 'success' | 'error' | 'info', message: string, title?: string) => {
      const id = `${Date.now()}_${Math.random()}`;
      setToasts((prev) => [...prev, { id, type, message, title }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 4500);
    },
    []
  );

  const dismissToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  // Recalculate conservative balance & pending queues (both outgoing & incoming)
  const refreshOfflineState = useCallback(async (currentWalletBalance?: number) => {
    try {
      const queued = await getQueuedTransactions();
      const count = await getPendingOfflineCount();
      const incoming = await getIncomingPendingTransfers();
      const incTotal = await calculateIncomingPendingTotal();

      setQueuedTransactions(queued);
      setIncomingPendingTransfers(incoming);
      setIncomingPendingTotal(incTotal);
      setPendingCount(count + incoming.length);

      const base = typeof currentWalletBalance === 'number' ? currentWalletBalance : wallet?.balance || 0;
      const conservative = await calculateConservativeBalance(base);
      setConservativeBalance(conservative);
    } catch (err) {
      console.warn('Error refreshing offline state:', err);
    }
  }, [wallet?.balance]);

  // Fetch latest wallet and transactions from server
  const fetchWalletData = useCallback(async (currentToken?: string) => {
    const token = currentToken || getStoredToken();
    if (!token) return;

    try {
      const res = await apiRequest('/api/wallet/me');
      if (res.data) {
        setUser(res.data.user);
        setWallet(res.data.wallet);
        setRecentTransactions(res.data.recentTransactions || []);

        // Cache locally for offline resilience
        await setCachedWallet(res.data.wallet.walletId, res.data.wallet);
        if (res.data.recentTransactions) {
          await setCachedTransactions(res.data.recentTransactions);
        }

        await refreshOfflineState(res.data.wallet.balance);
      } else if (res.status === 401) {
        // Session expired
        setStoredToken(null);
        setUser(null);
        setWallet(null);
      }
    } catch {
      // In offline mode, attempt loading from IndexedDB
      if (user?.walletId) {
        const cachedW = await getCachedWallet(user.walletId);
        if (cachedW) setWallet(cachedW);
        const cachedTxs = await getCachedTransactions();
        setRecentTransactions(cachedTxs);
        await refreshOfflineState(cachedW?.balance);
      }
    }
  }, [refreshOfflineState, user?.walletId]);

  // Sync offline queued transactions and incoming vouchers with server
  const syncOfflineTransactions = useCallback(async () => {
    if (!isOnline || isSyncing) return;

    try {
      const queued = await getQueuedTransactions();
      const incoming = await getIncomingPendingTransfers();

      const totalCount = queued.length + incoming.length;
      if (totalCount === 0) return;

      setIsSyncing(true);
      showToast('info', `Synchronizing ${totalCount} offline transactions with ledger...`, 'Sync in Progress');

      const outgoingPayloads = queued.map((item) => ({
        txId: item.txId,
        senderWalletId: item.senderWalletId || wallet?.walletId,
        receiverWalletId: item.receiverWalletId,
        amount: item.amount,
        nonce: item.nonce,
        signature: item.signature,
        queuedAt: item.queuedAt,
      }));

      const incomingPayloads = incoming.map((item) => ({
        txId: item.txId,
        senderWalletId: item.senderWalletId,
        receiverWalletId: item.receiverWalletId,
        amount: item.amount,
        nonce: item.nonce,
        signature: item.signature,
        queuedAt: item.receivedAt,
      }));

      // Deduplicate by txId
      const uniqueMap = new Map<string, any>();
      for (const item of [...outgoingPayloads, ...incomingPayloads]) {
        uniqueMap.set(item.txId, item);
      }
      const combinedTransactions = Array.from(uniqueMap.values());

      const res = await apiRequest('/api/wallet/sync-offline', {
        method: 'POST',
        body: JSON.stringify({ transactions: combinedTransactions }),
      });

      if (res.data?.summary) {
        const { syncedCount, rejectedCount, alreadyProcessedCount } = res.data.summary;

        // Clear successfully processed transactions from offline queues
        for (const item of queued) {
          await removeQueuedTransaction(item.txId);
        }
        for (const inc of incoming) {
          await removeIncomingPendingTransfer(inc.txId);
        }

        if (typeof res.data.currentBalance === 'number') {
          setWallet((prev) => (prev ? { ...prev, balance: res.data.currentBalance } : prev));
        }

        showToast(
          'success',
          `Sync complete: ${syncedCount} accepted, ${alreadyProcessedCount} reconciled, ${rejectedCount} rejected.`,
          'Synchronization Complete'
        );

        // Refresh entire ledger
        await fetchWalletData();
      } else if (res.error) {
        showToast('error', res.error, 'Sync Failed');
      }
    } catch (err: any) {
      showToast('error', err.message || 'Synchronization failed.');
    } finally {
      setIsSyncing(false);
      await refreshOfflineState();
    }
  }, [isOnline, isSyncing, showToast, wallet?.walletId, fetchWalletData, refreshOfflineState]);

  // Handler when recipient scans an offline payment voucher from sender
  const handleVoucherScanned = useCallback(async (voucher: OfflinePaymentVoucherPayload) => {
    try {
      await recordIncomingPendingTransfer({
        txId: voucher.txId,
        senderWalletId: voucher.senderWalletId,
        senderName: voucher.senderName,
        receiverWalletId: voucher.receiverWalletId,
        amount: voucher.amount,
        nonce: voucher.nonce,
        signature: voucher.signature,
        receivedAt: voucher.timestamp || new Date().toISOString(),
        status: 'pending_incoming',
      });

      showToast(
        'success',
        `Incoming payment of ${voucher.amount} coins from ${voucher.senderWalletId} recorded! Will settle upon sync.`,
        'Voucher Registered'
      );

      await refreshOfflineState();

      // If already online, trigger immediate synchronization
      if (networkMonitor.isOnline()) {
        setTimeout(() => {
          syncOfflineTransactions();
        }, 400);
      }
    } catch (err: any) {
      showToast('error', err.message || 'Failed to record incoming voucher.');
    }
  }, [showToast, refreshOfflineState, syncOfflineTransactions]);

  // Network monitor subscription
  useEffect(() => {
    const unsubscribe = networkMonitor.subscribe((online) => {
      setIsOnline(online);
      if (online) {
        showToast('info', 'Network connection restored. Auto-syncing...', 'Back Online');
        syncOfflineTransactions();
      } else {
        showToast('info', 'Operating in offline mode. Transfers will queue in IndexedDB.', 'Offline Mode');
      }
    });
    return () => unsubscribe();
  }, [showToast, syncOfflineTransactions]);

  // Initial startup: check active session
  useEffect(() => {
    async function init() {
      const token = getStoredToken();
      if (token) {
        await fetchWalletData(token);
      }
      setIsInitialLoading(false);
    }
    init();
  }, [fetchWalletData]);

  // Handle successful login or account creation
  const handleAuthSuccess = (authedUser: UserProfile, authedWallet: WalletState) => {
    setUser(authedUser);
    setWallet(authedWallet);
    setCurrentTab('dashboard');
    refreshOfflineState(authedWallet.balance);
    fetchWalletData();
  };

  // Functional Logout (Section 18.A)
  const handleLogout = async () => {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' });
    } catch (err) {
      console.warn('Logout API notice:', err);
    }
    setStoredToken(null);
    setUser(null);
    setWallet(null);
    setRecentTransactions([]);
    setCurrentTab('dashboard');
    showToast('info', 'You have been logged out safely.', 'Signed Out');
  };

  // Faucet request handler
  const handleRequestFaucet = async () => {
    try {
      const res = await apiRequest('/api/wallet/faucet', { method: 'POST' });
      if (res.data?.success) {
        showToast('success', res.data.message, 'Faucet Granted');
        await fetchWalletData();
      } else {
        showToast('error', res.error || 'Failed to request test coins.');
      }
    } catch {
      showToast('error', 'Faucet request failed.');
    }
  };

  // Handle transfer completion
  const handleTransferSuccess = async () => {
    await fetchWalletData();
    await refreshOfflineState();
  };

  // Handle manual history refresh
  const handleRefreshHistory = async () => {
    setIsHistoryLoading(true);
    await fetchWalletData();
    await refreshOfflineState();
    setIsHistoryLoading(false);
  };

  if (isInitialLoading) {
    return (
      <div className="min-h-screen bg-[#080e1e] flex flex-col items-center justify-center space-y-4">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-blue-600 to-cyan-400 flex items-center justify-center shadow-xl animate-pulse">
          <span className="font-extrabold text-white text-base">CP</span>
        </div>
        <div className="text-xs text-slate-400 font-medium">Starting CoinPath Virtual Wallet...</div>
      </div>
    );
  }

  // If not logged in, render authentication screens
  if (!user || !wallet) {
    return (
      <>
        <ToastContainer toasts={toasts} onDismiss={dismissToast} />
        <AuthScreens onAuthSuccess={handleAuthSuccess} showToast={showToast} />
      </>
    );
  }

  return (
    <div className="min-h-screen bg-[#080e1e] text-slate-100 flex flex-col selection:bg-blue-600 selection:text-white">
      {/* Toast Notifications */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      {/* Android Capacitor Guide Modal */}
      <AndroidGuideModal
        isOpen={showAndroidGuide}
        onClose={() => setShowAndroidGuide(false)}
      />

      {/* App Top Bar */}
      <Header
        title="CoinPath"
        isOnline={isOnline}
        pendingCount={pendingCount}
        onSyncClick={syncOfflineTransactions}
        onAndroidInfoClick={() => setShowAndroidGuide(true)}
        isSyncing={isSyncing}
      />

      {/* Main Responsive Content Container */}
      <main className="flex-1 max-w-lg w-full mx-auto px-4 pt-4 pb-20">
        {currentTab === 'dashboard' && (
          <Dashboard
            user={user}
            wallet={wallet}
            conservativeBalance={conservativeBalance}
            recentTransactions={recentTransactions}
            isOnline={isOnline}
            pendingCount={pendingCount}
            incomingPendingTransfers={incomingPendingTransfers}
            incomingPendingTotal={incomingPendingTotal}
            onNavigateTab={(tab) => {
              setOpenScannerOnSend(false);
              setCurrentTab(tab);
            }}
            onOpenScanner={() => {
              setOpenScannerOnSend(true);
              setCurrentTab('send');
            }}
            onRequestFaucet={handleRequestFaucet}
            onSyncNow={syncOfflineTransactions}
            isSyncing={isSyncing}
          />
        )}

        {currentTab === 'send' && (
          <SendCoins
            user={user}
            wallet={wallet}
            conservativeBalance={conservativeBalance}
            isOnline={isOnline}
            initialOpenScanner={openScannerOnSend}
            onTransferSuccess={handleTransferSuccess}
            onVoucherScanned={handleVoucherScanned}
            showToast={showToast}
          />
        )}

        {currentTab === 'receive' && (
          <ReceiveCoins
            user={user}
            wallet={wallet}
            showToast={showToast}
            onVoucherReceived={handleVoucherScanned}
          />
        )}

        {currentTab === 'history' && (
          <TransactionHistory
            wallet={wallet}
            transactions={recentTransactions}
            queuedTransactions={queuedTransactions}
            incomingPendingTransfers={incomingPendingTransfers}
            isLoading={isHistoryLoading}
            onRefresh={handleRefreshHistory}
          />
        )}

        {currentTab === 'profile' && (
          <ProfileSettings
            user={user}
            wallet={wallet}
            isOnline={isOnline}
            pendingCount={pendingCount}
            onSyncNow={syncOfflineTransactions}
            onLogout={handleLogout}
            onLimitUpdated={(newLimit) => {
              setWallet((prev) => (prev ? { ...prev, maxTxLimit: newLimit } : prev));
            }}
            onOpenAndroidGuide={() => setShowAndroidGuide(true)}
            showToast={showToast}
            isSyncing={isSyncing}
          />
        )}
      </main>

      {/* Bottom Navigation */}
      <BottomNav
        currentTab={currentTab}
        onChangeTab={(tab) => {
          setOpenScannerOnSend(false);
          setCurrentTab(tab);
        }}
        pendingCount={pendingCount}
      />
    </div>
  );
}
