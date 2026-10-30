import React from 'react';
import { Home, ArrowUpRight, ArrowDownLeft, Clock, User } from 'lucide-react';

export type TabType = 'dashboard' | 'send' | 'receive' | 'history' | 'profile';

interface BottomNavProps {
  currentTab: TabType;
  onChangeTab: (tab: TabType) => void;
  pendingCount?: number;
}

export const BottomNav: React.FC<BottomNavProps> = ({ currentTab, onChangeTab, pendingCount = 0 }) => {
  const tabs: { id: TabType; label: string; icon: React.ElementType }[] = [
    { id: 'dashboard', label: 'Wallet', icon: Home },
    { id: 'send', label: 'Send', icon: ArrowUpRight },
    { id: 'receive', label: 'Receive', icon: ArrowDownLeft },
    { id: 'history', label: 'History', icon: Clock },
    { id: 'profile', label: 'Settings', icon: User },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-[#080e1e]/95 backdrop-blur-md border-t border-slate-800/80 pb-safe">
      <div className="max-w-lg mx-auto grid grid-cols-5 h-16">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = currentTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onChangeTab(tab.id)}
              className={`min-h-[44px] flex flex-col items-center justify-center relative transition-colors ${
                isActive ? 'text-blue-400 font-semibold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <div className="relative">
                <Icon className={`w-5 h-5 ${isActive ? 'stroke-[2.5px]' : 'stroke-2'}`} />
                {tab.id === 'history' && pendingCount > 0 && (
                  <span className="absolute -top-1 -right-2 px-1 min-w-[14px] h-[14px] rounded-full bg-amber-500 text-[9px] font-bold text-slate-950 flex items-center justify-center">
                    {pendingCount}
                  </span>
                )}
              </div>
              <span className="text-[11px] mt-1 tracking-tight">{tab.label}</span>
              {isActive && (
                <div className="absolute bottom-1 w-6 h-0.5 bg-blue-500 rounded-full" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
};
