import React from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info';
  title?: string;
  message: string;
}

interface ToastContainerProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onDismiss }) => {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-16 left-0 right-0 z-50 px-4 pointer-events-none flex flex-col items-center gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`pointer-events-auto max-w-md w-full p-3 rounded-xl border shadow-xl flex items-start gap-3 transition-all transform animate-in fade-in slide-in-from-top-2 ${
            toast.type === 'error'
              ? 'bg-rose-950/90 border-rose-800 text-rose-200'
              : toast.type === 'success'
              ? 'bg-emerald-950/90 border-emerald-800 text-emerald-200'
              : 'bg-slate-900/90 border-slate-700 text-slate-200'
          }`}
        >
          {toast.type === 'error' && <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />}
          {toast.type === 'success' && <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />}
          {toast.type === 'info' && <Info className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />}

          <div className="flex-1 text-xs">
            {toast.title && <div className="font-semibold text-sm mb-0.5">{toast.title}</div>}
            <div className="leading-relaxed">{toast.message}</div>
          </div>

          <button
            onClick={() => onDismiss(toast.id)}
            className="text-slate-400 hover:text-white p-1 rounded-md"
            aria-label="Dismiss toast"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  );
};
