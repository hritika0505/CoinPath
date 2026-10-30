import React, { useState } from 'react';
import {
  User,
  Shield,
  Sliders,
  RefreshCw,
  LogOut,
  Trash2,
  Globe,
  Check,
  AlertTriangle,
  Smartphone,
  ExternalLink,
} from 'lucide-react';
import { UserProfile, WalletState } from '../../types/wallet.ts';
import { apiRequest, getApiBaseUrl, setCustomApiBaseUrl } from '../../services/api.ts';
import { purgeLocalCache } from '../../services/offline-store.ts';

interface ProfileSettingsProps {
  user: UserProfile;
  wallet: WalletState;
  isOnline: boolean;
  pendingCount: number;
  onSyncNow: () => void;
  onLogout: () => void;
  onLimitUpdated: (newLimit: number) => void;
  onOpenAndroidGuide: () => void;
  showToast: (type: 'success' | 'error' | 'info', message: string, title?: string) => void;
  isSyncing?: boolean;
}

export const ProfileSettings: React.FC<ProfileSettingsProps> = ({
  user,
  wallet,
  isOnline,
  pendingCount,
  onSyncNow,
  onLogout,
  onLimitUpdated,
  onOpenAndroidGuide,
  showToast,
  isSyncing = false,
}) => {
  // Limit modal state
  const [isEditingLimit, setIsEditingLimit] = useState(false);
  const [newLimitInput, setNewLimitInput] = useState(String(wallet.maxTxLimit || 200));
  const [isUpdatingLimit, setIsUpdatingLimit] = useState(false);

  // Backend host URL configuration (for Android physical phone testing)
  const [customBackendUrl, setCustomBackendUrl] = useState(getApiBaseUrl());
  const [isSavedUrl, setIsSavedUrl] = useState(false);

  // Logout confirmation modal
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  // Cache cleanup confirmation modal
  const [showPurgeConfirm, setShowPurgeConfirm] = useState(false);

  const handleSaveLimit = async (e: React.FormEvent) => {
    e.preventDefault();
    const numeric = Number(newLimitInput);
    if (!Number.isInteger(numeric) || numeric < 10 || numeric > 2000) {
      showToast('error', 'Limit must be an integer between 10 and 2,000 coins.');
      return;
    }

    setIsUpdatingLimit(true);
    try {
      const res = await apiRequest('/api/wallet/settings/limit', {
        method: 'POST',
        body: JSON.stringify({ maxTxLimit: numeric }),
      });

      if (res.error) {
        showToast('error', res.error);
      } else {
        onLimitUpdated(numeric);
        setIsEditingLimit(false);
        showToast('success', `Transfer limit updated to ${numeric} coins.`);
      }
    } catch {
      showToast('error', 'Failed to update transfer limit.');
    } finally {
      setIsUpdatingLimit(false);
    }
  };

  const handleSaveBackendUrl = (e: React.FormEvent) => {
    e.preventDefault();
    setCustomApiBaseUrl(customBackendUrl);
    setIsSavedUrl(true);
    showToast('success', 'Backend API URL updated for mobile/network routing.');
    setTimeout(() => setIsSavedUrl(false), 2000);
  };

  const handlePurgeCache = async () => {
    try {
      await purgeLocalCache(true); // preserve pending offline queue
      setShowPurgeConfirm(false);
      showToast('success', 'Local cached data cleared safely. Pending offline queue preserved.');
    } catch (err: any) {
      showToast('error', 'Failed to clear cache.');
    }
  };

  return (
    <div className="space-y-5 pb-8">
      {/* Title */}
      <div>
        <h2 className="text-xl font-bold text-white tracking-tight">Profile & Settings</h2>
        <p className="text-xs text-slate-400">Account security, transfer controls, and synchronization</p>
      </div>

      {/* Account Info Card */}
      <div className="p-5 rounded-3xl bg-[#0f172a] border border-slate-800 space-y-4 shadow-xl">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-blue-600/20 text-blue-400 flex items-center justify-center font-bold text-base">
            <User className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white">{user.fullName}</h3>
            <div className="text-xs text-slate-400 font-mono">@{user.username} · {user.email}</div>
          </div>
        </div>

        <div className="pt-3 border-t border-slate-800 flex justify-between items-center text-xs">
          <span className="text-slate-400">Registered Wallet ID:</span>
          <span className="font-mono font-semibold text-cyan-400">{wallet.walletId}</span>
        </div>

        <div className="flex justify-between items-center text-xs">
          <span className="text-slate-400">P-256 ECDSA Key:</span>
          <span className="text-emerald-400 font-mono text-[11px] flex items-center gap-1">
            <Shield className="w-3.5 h-3.5" /> Hardware/WebCrypto Active
          </span>
        </div>
      </div>

      {/* Transaction Limit Controls */}
      <div className="p-5 rounded-3xl bg-[#0f172a] border border-slate-800 space-y-3 shadow-xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sliders className="w-5 h-5 text-blue-400" />
            <h3 className="text-sm font-bold text-white">Transfer Protection Limit</h3>
          </div>
          <button
            onClick={() => setIsEditingLimit(true)}
            className="text-xs text-blue-400 hover:text-blue-300 font-semibold transition-colors"
          >
            Change
          </button>
        </div>

        <p className="text-xs text-slate-400 leading-relaxed">
          Default maximum transfer limit is <strong>200 coins</strong> per transaction to protect against accidental overspending.
        </p>

        <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between">
          <span className="text-xs text-slate-400">Current Cap:</span>
          <span className="text-base font-bold font-mono text-cyan-400">
            {wallet.maxTxLimit || 200} Virtual Coins
          </span>
        </div>
      </div>

      {/* Offline Queue & Synchronization Action */}
      <div className="p-5 rounded-3xl bg-[#0f172a] border border-slate-800 space-y-3 shadow-xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <RefreshCw className={`w-5 h-5 text-amber-400 ${isSyncing ? 'animate-spin' : ''}`} />
            <h3 className="text-sm font-bold text-white">Offline Synchronization</h3>
          </div>
          <span className="text-xs font-mono text-slate-400">{pendingCount} queued</span>
        </div>

        <p className="text-xs text-slate-400 leading-relaxed">
          CoinPath stores transfers in IndexedDB when offline. You can trigger synchronization manually at any time.
        </p>

        <button
          onClick={onSyncNow}
          disabled={!isOnline || isSyncing || pendingCount === 0}
          className="w-full h-11 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-slate-950 font-bold text-xs rounded-xl flex items-center justify-center gap-2 transition-colors cursor-pointer"
        >
          <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
          <span>{isSyncing ? 'Syncing with Server...' : `Sync ${pendingCount} Queued Transactions`}</span>
        </button>
      </div>

      {/* Android & Physical Device URL Setting */}
      <div className="p-5 rounded-3xl bg-[#0f172a] border border-slate-800 space-y-3 shadow-xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Globe className="w-5 h-5 text-cyan-400" />
            <h3 className="text-sm font-bold text-white">Android / Remote Server Target</h3>
          </div>
          <button
            onClick={onOpenAndroidGuide}
            className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 font-semibold"
          >
            <Smartphone className="w-3.5 h-3.5" />
            <span>Guide</span>
          </button>
        </div>

        <p className="text-xs text-slate-400 leading-relaxed">
          Physical Android devices and emulators cannot reach <code className="text-slate-300">localhost</code> directly. Configure your machine's LAN IP or deployed backend URL here.
        </p>

        <form onSubmit={handleSaveBackendUrl} className="space-y-2">
          <div className="flex gap-2">
            <input
              type="text"
              value={customBackendUrl}
              onChange={(e) => setCustomBackendUrl(e.target.value)}
              placeholder="e.g. http://192.168.1.100:3000 or empty for relative"
              className="flex-1 px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
            />
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs rounded-xl transition-colors shrink-0"
            >
              {isSavedUrl ? <Check className="w-4 h-4 text-emerald-400" /> : 'Save URL'}
            </button>
          </div>
        </form>
      </div>

      {/* Cache & App Actions */}
      <div className="space-y-2">
        <button
          onClick={() => setShowPurgeConfirm(true)}
          className="w-full h-11 rounded-2xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs font-semibold text-slate-300 hover:text-white flex items-center justify-center gap-2 transition-colors cursor-pointer"
        >
          <Trash2 className="w-4 h-4 text-slate-400" />
          <span>Clear Local Device Cache (Safe)</span>
        </button>

        {/* LOGOUT BUTTON (Section 18.A) */}
        <button
          onClick={() => setShowLogoutConfirm(true)}
          className="w-full h-12 rounded-2xl bg-rose-950/40 hover:bg-rose-900/60 border border-rose-900/60 text-xs font-bold text-rose-300 hover:text-rose-100 flex items-center justify-center gap-2 transition-colors cursor-pointer"
        >
          <LogOut className="w-4 h-4 text-rose-400" />
          <span>Sign Out / Lock Wallet</span>
        </button>
      </div>

      {/* Disclaimer */}
      <div className="p-4 rounded-2xl bg-[#080e1e] border border-slate-800/80 text-center space-y-1">
        <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
          Educational Virtual Wallet Prototype
        </div>
        <p className="text-[11px] text-slate-500 leading-relaxed">
          CoinPath is a software prototype for educational and research purposes. Virtual coins do not represent real-world currency, legal tender, or banking deposits.
        </p>
      </div>

      {/* Limit Edit Modal */}
      {isEditingLimit && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveLimit}
            className="max-w-xs w-full bg-[#0f172a] border border-slate-700 rounded-3xl p-6 shadow-2xl space-y-4"
          >
            <h3 className="text-base font-bold text-white">Adjust Transfer Limit</h3>
            <p className="text-xs text-slate-400">
              Set the maximum allowed virtual coins per individual transfer (allowed: 10 to 2,000 coins).
            </p>

            <div>
              <input
                type="number"
                min="10"
                max="2000"
                value={newLimitInput}
                onChange={(e) => setNewLimitInput(e.target.value)}
                required
                className="w-full px-3 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-base font-mono text-white text-center focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsEditingLimit(false)}
                className="h-10 rounded-xl bg-slate-800 text-slate-300 text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isUpdatingLimit}
                className="h-10 rounded-xl bg-blue-600 text-white text-xs font-bold"
              >
                {isUpdatingLimit ? 'Saving...' : 'Save Limit'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Logout Confirmation Modal */}
      {showLogoutConfirm && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="max-w-xs w-full bg-[#0f172a] border border-slate-700 rounded-3xl p-6 shadow-2xl space-y-4 text-center">
            <div className="w-12 h-12 rounded-full bg-rose-600/20 text-rose-400 flex items-center justify-center mx-auto">
              <LogOut className="w-6 h-6" />
            </div>

            <div className="space-y-1">
              <h3 className="text-base font-bold text-white">Log Out of CoinPath?</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Your session token will be terminated. Your wallet balance and pending offline transactions will be safely preserved.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowLogoutConfirm(false)}
                className="h-11 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowLogoutConfirm(false);
                  onLogout();
                }}
                className="h-11 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold shadow-lg shadow-rose-600/30 cursor-pointer"
              >
                Yes, Sign Out
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Purge Cache Confirmation Modal */}
      {showPurgeConfirm && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="max-w-xs w-full bg-[#0f172a] border border-slate-700 rounded-3xl p-6 shadow-2xl space-y-4 text-center">
            <div className="w-12 h-12 rounded-full bg-amber-600/20 text-amber-400 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-6 h-6" />
            </div>

            <div className="space-y-1">
              <h3 className="text-base font-bold text-white">Clear Cached Data?</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                This will clear locally stored view caches. Your un-synchronized pending offline transactions will NOT be lost.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowPurgeConfirm(false)}
                className="h-11 rounded-xl bg-slate-800 text-slate-300 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handlePurgeCache}
                className="h-11 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold"
              >
                Clear Cache
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
