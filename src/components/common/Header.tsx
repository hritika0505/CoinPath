import React from 'react';
import { Wifi, WifiOff, RefreshCw, Smartphone } from 'lucide-react';

interface HeaderProps {
  title: string;
  isOnline: boolean;
  pendingCount: number;
  onSyncClick?: () => void;
  onAndroidInfoClick?: () => void;
  isSyncing?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  title,
  isOnline,
  pendingCount,
  onSyncClick,
  onAndroidInfoClick,
  isSyncing = false,
}) => {
  return (
    <header className="sticky top-0 z-30 w-full bg-[#080e1e]/90 backdrop-blur-md border-b border-slate-800/80 px-4 py-3 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-blue-600 to-cyan-400 flex items-center justify-center shadow-sm">
          <span className="font-bold text-white text-sm">CP</span>
        </div>
        <div>
          <h1 className="text-base font-bold text-white tracking-tight leading-tight">{title}</h1>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span>Virtual Wallet</span>
            <span aria-hidden="true">·</span>
            <span className={isOnline ? 'text-emerald-400' : 'text-amber-400'}>
              {isOnline ? 'Online' : 'Offline'}
            </span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {pendingCount > 0 && (
          <button
            onClick={onSyncClick}
            disabled={!isOnline || isSyncing}
            className={`min-h-[40px] px-2.5 py-1 text-xs font-medium rounded-lg flex items-center gap-1.5 transition-colors ${
              isOnline
                ? 'bg-blue-950/80 text-blue-300 border border-blue-800/60 hover:bg-blue-900/60'
                : 'bg-slate-800/60 text-slate-400 border border-slate-700/60 cursor-not-allowed'
            }`}
            title="Pending transactions awaiting server synchronization"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
            <span>{pendingCount} Pending</span>
          </button>
        )}

        {onAndroidInfoClick && (
          <button
            onClick={onAndroidInfoClick}
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg bg-slate-800/60 text-slate-300 hover:text-white hover:bg-slate-800 transition-colors border border-slate-700/60"
            title="Android APK & Capacitor Build Guide"
            aria-label="Android Build Info"
          >
            <Smartphone className="w-4 h-4" />
          </button>
        )}

        <div className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg bg-slate-900 border border-slate-800 text-slate-400">
          {isOnline ? (
            <Wifi className="w-4 h-4 text-emerald-400" />
          ) : (
            <WifiOff className="w-4 h-4 text-amber-400" />
          )}
        </div>
      </div>
    </header>
  );
};
