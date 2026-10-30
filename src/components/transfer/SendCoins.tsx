import React, { useState, useEffect } from 'react';
import {
  ArrowUpRight,
  QrCode,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  Clock,
  UserCheck,
  Loader2,
  XCircle,
} from 'lucide-react';
import { UserProfile, WalletState } from '../../types/wallet.ts';
import { apiRequest } from '../../services/api.ts';
import { getSavedPrivateKey, signTransactionPayload } from '../../services/crypto.ts';
import { queueOfflineTransaction } from '../../services/offline-store.ts';
import { QrScanner } from './QrScanner.tsx';

interface SendCoinsProps {
  user: UserProfile;
  wallet: WalletState;
  conservativeBalance: number;
  isOnline: boolean;
  prefilledRecipient?: string;
  initialOpenScanner?: boolean;
  onTransferSuccess: () => void;
  showToast: (type: 'success' | 'error' | 'info', message: string, title?: string) => void;
}

export const SendCoins: React.FC<SendCoinsProps> = ({
  user,
  wallet,
  conservativeBalance,
  isOnline,
  prefilledRecipient = '',
  initialOpenScanner = false,
  onTransferSuccess,
  showToast,
}) => {
  const [recipientInput, setRecipientInput] = useState(prefilledRecipient);
  const [amountInput, setAmountInput] = useState('');
  const [showScanner, setShowScanner] = useState(initialOpenScanner);

  useEffect(() => {
    if (initialOpenScanner) {
      setShowScanner(true);
    }
  }, [initialOpenScanner]);

  // Recipient verification state
  const [isVerifyingRecipient, setIsVerifyingRecipient] = useState(false);
  const [verifiedRecipient, setVerifiedRecipient] = useState<{
    walletId: string;
    username: string;
    fullName: string;
  } | null>(null);
  const [recipientError, setRecipientError] = useState<string | null>(null);

  // Transfer flow states
  const [isConfirming, setIsConfirming] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [transferResult, setTransferResult] = useState<{
    status: 'accepted' | 'rejected' | 'queued_offline';
    message: string;
    txId: string;
  } | null>(null);

  const maxTxLimit = wallet.maxTxLimit || 200;

  // Real-time limit check error while typing
  const numericAmount = Number(amountInput);
  const isOverLimit = numericAmount > maxTxLimit;
  const isZeroOrNegative = amountInput !== '' && (numericAmount <= 0 || !Number.isInteger(numericAmount));
  const isInsufficient = numericAmount > conservativeBalance;

  // Verify recipient debounced or on change
  useEffect(() => {
    const cleanId = recipientInput.trim();
    if (!cleanId) {
      setVerifiedRecipient(null);
      setRecipientError(null);
      return;
    }

    if (cleanId === wallet.walletId) {
      setVerifiedRecipient(null);
      setRecipientError('Cannot send coins to your own wallet.');
      return;
    }

    // If format looks like a wallet ID (CP-xxxx-xxxx)
    if (/^CP-\d{4}-\d{4}$/.test(cleanId) || cleanId.length >= 6) {
      const timer = setTimeout(async () => {
        setIsVerifyingRecipient(true);
        setRecipientError(null);
        try {
          const res = await apiRequest(`/api/wallet/recipient/${cleanId}`);
          if (res.data?.exists) {
            setVerifiedRecipient(res.data);
            setRecipientError(null);
          } else {
            setVerifiedRecipient(null);
            setRecipientError(res.error || 'Recipient wallet not found.');
          }
        } catch {
          setVerifiedRecipient(null);
          setRecipientError('Could not verify recipient.');
        } finally {
          setIsVerifyingRecipient(false);
        }
      }, 400);

      return () => clearTimeout(timer);
    } else {
      setVerifiedRecipient(null);
      setRecipientError(null);
    }
  }, [recipientInput, wallet.walletId]);

  // Handle Review Click
  const handleReview = (e: React.FormEvent) => {
    e.preventDefault();

    if (!recipientInput.trim()) {
      showToast('error', 'Please enter a recipient wallet ID.');
      return;
    }

    if (recipientInput.trim() === wallet.walletId) {
      showToast('error', 'Cannot send coins to your own wallet.');
      return;
    }

    if (!amountInput || !Number.isInteger(numericAmount) || numericAmount <= 0) {
      showToast('error', 'Transfer amount must be a positive integer.');
      return;
    }

    // Section 6 mandatory limit check and exact alert wording
    if (numericAmount > maxTxLimit) {
      showToast(
        'error',
        `Transfer limit exceeded. The maximum allowed per transaction is ${maxTxLimit} coins.`,
        'Limit Exceeded'
      );
      return;
    }

    if (numericAmount > conservativeBalance) {
      showToast(
        'error',
        `Insufficient balance. You have ${conservativeBalance} available virtual coins.`,
        'Insufficient Balance'
      );
      return;
    }

    setIsConfirming(true);
  };

  // Submit transfer (Online atomic transfer or Offline queueing)
  const handleConfirmTransfer = async () => {
    setIsSubmitting(true);
    const txId = `tx_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const nonce = `nonce_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const targetRecipient = recipientInput.trim();

    try {
      // 1. Sign transaction cryptographically with P-256 private key if available
      let signatureHex: string | undefined = undefined;
      const privateKeyJwk = getSavedPrivateKey(user.username);
      if (privateKeyJwk) {
        try {
          signatureHex = await signTransactionPayload(privateKeyJwk, {
            senderWalletId: wallet.walletId,
            receiverWalletId: targetRecipient,
            amount: numericAmount,
            nonce,
          });
        } catch (signErr) {
          console.warn('P-256 signature calculation notice:', signErr);
        }
      }

      // 2. If OFFLINE, queue in IndexedDB
      if (!isOnline) {
        await queueOfflineTransaction({
          txId,
          receiverWalletId: targetRecipient,
          receiverName: verifiedRecipient?.fullName || targetRecipient,
          amount: numericAmount,
          nonce,
          signature: signatureHex,
          queuedAt: new Date().toISOString(),
          status: 'pending_sync',
        });

        setTransferResult({
          status: 'queued_offline',
          message: `Transfer of ${numericAmount} coins is queued offline. It will synchronize automatically when your device reconnects.`,
          txId,
        });

        showToast(
          'info',
          `Queued ${numericAmount} coins for offline sync. Conservative balance adjusted.`,
          'Queued Offline'
        );
        onTransferSuccess();
        setIsSubmitting(false);
        return;
      }

      // 3. If ONLINE, submit to backend
      const res = await apiRequest('/api/wallet/transfer', {
        method: 'POST',
        body: JSON.stringify({
          txId,
          receiverWalletId: targetRecipient,
          amount: numericAmount,
          nonce,
          signature: signatureHex,
        }),
      });

      if (res.error || !res.data) {
        setTransferResult({
          status: 'rejected',
          message: res.error || 'Server rejected the transaction.',
          txId,
        });
        showToast('error', res.error || 'Transfer failed.', 'Transfer Rejected');
        setIsSubmitting(false);
        return;
      }

      setTransferResult({
        status: 'accepted',
        message: `Successfully transferred ${numericAmount} virtual coins to ${targetRecipient}.`,
        txId,
      });

      showToast('success', `Sent ${numericAmount} coins!`, 'Transfer Accepted');
      onTransferSuccess();
    } catch (err: any) {
      showToast('error', err.message || 'Transaction submission error.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetForm = () => {
    setTransferResult(null);
    setIsConfirming(false);
    setAmountInput('');
    setRecipientInput('');
    setVerifiedRecipient(null);
  };

  return (
    <div className="space-y-5 pb-8">
      {/* Title */}
      <div>
        <h2 className="text-xl font-bold text-white tracking-tight">Send Virtual Coins</h2>
        <p className="text-xs text-slate-400">
          Transfer virtual coins securely with P-256 cryptographic authorization.
        </p>
      </div>

      {/* RESULT SCREEN */}
      {transferResult ? (
        <div className="p-6 rounded-3xl bg-[#0f172a] border border-slate-800 text-center space-y-4 shadow-xl">
          <div
            className={`w-14 h-14 rounded-2xl flex items-center justify-center mx-auto ${
              transferResult.status === 'accepted'
                ? 'bg-emerald-600/20 text-emerald-400'
                : transferResult.status === 'queued_offline'
                ? 'bg-amber-600/20 text-amber-400'
                : 'bg-rose-600/20 text-rose-400'
            }`}
          >
            {transferResult.status === 'accepted' && <CheckCircle2 className="w-8 h-8" />}
            {transferResult.status === 'queued_offline' && <Clock className="w-8 h-8" />}
            {transferResult.status === 'rejected' && <XCircle className="w-8 h-8" />}
          </div>

          <div className="space-y-1">
            <h3 className="text-lg font-bold text-white">
              {transferResult.status === 'accepted' && 'Transaction Accepted'}
              {transferResult.status === 'queued_offline' && 'Queued Offline'}
              {transferResult.status === 'rejected' && 'Transaction Rejected'}
            </h3>
            <p className="text-xs text-slate-300 leading-relaxed max-w-sm mx-auto">
              {transferResult.message}
            </p>
          </div>

          <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 text-left text-xs font-mono text-slate-400 space-y-1">
            <div>Tx ID: <span className="text-slate-200">{transferResult.txId}</span></div>
            <div>Recipient: <span className="text-slate-200">{recipientInput}</span></div>
            <div>Amount: <span className="text-emerald-400 font-bold">{numericAmount} coins</span></div>
          </div>

          <button
            onClick={handleResetForm}
            className="w-full h-11 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs transition-colors cursor-pointer"
          >
            Make Another Transfer
          </button>
        </div>
      ) : isConfirming ? (
        /* CONFIRMATION SCREEN */
        <div className="p-6 rounded-3xl bg-[#0f172a] border border-blue-900/60 space-y-5 shadow-2xl">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <h3 className="text-base font-bold text-white">Confirm Transfer</h3>
            <span className="text-xs text-blue-400 font-medium">Review Details</span>
          </div>

          <div className="space-y-3 text-xs">
            <div className="flex justify-between p-3 rounded-xl bg-slate-900 border border-slate-800">
              <span className="text-slate-400">Recipient:</span>
              <div className="text-right">
                <span className="font-mono font-bold text-white block">{recipientInput}</span>
                {verifiedRecipient && (
                  <span className="text-slate-400 text-[11px]">{verifiedRecipient.fullName} (@{verifiedRecipient.username})</span>
                )}
              </div>
            </div>

            <div className="flex justify-between p-3 rounded-xl bg-slate-900 border border-slate-800">
              <span className="text-slate-400">Amount:</span>
              <span className="text-base font-bold text-emerald-400 font-mono tabular-nums">
                {numericAmount.toLocaleString()} Coins
              </span>
            </div>

            <div className="flex justify-between p-3 rounded-xl bg-slate-900 border border-slate-800">
              <span className="text-slate-400">Remaining Balance:</span>
              <span className="font-mono font-semibold text-slate-200">
                {(conservativeBalance - numericAmount).toLocaleString()} Coins
              </span>
            </div>

            <div className="flex justify-between p-3 rounded-xl bg-slate-900 border border-slate-800">
              <span className="text-slate-400">Network State:</span>
              <span className={isOnline ? 'text-emerald-400 font-medium' : 'text-amber-400 font-medium'}>
                {isOnline ? 'Online (Direct commit)' : 'Offline (Will queue in IndexedDB)'}
              </span>
            </div>

            <div className="flex justify-between p-3 rounded-xl bg-slate-900 border border-slate-800">
              <span className="text-slate-400">Cryptographic Signature:</span>
              <span className="text-blue-400 font-medium flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5" /> P-256 ECDSA
              </span>
            </div>
          </div>

          {!isOnline && (
            <div className="p-3 rounded-xl bg-amber-950/40 border border-amber-800/60 text-xs text-amber-300 flex items-start gap-2">
              <Clock className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
              <span>
                You are currently offline. This transfer will be stored in your device's local offline queue and presented to the server once reconnected.
              </span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 pt-2">
            <button
              type="button"
              onClick={() => setIsConfirming(false)}
              disabled={isSubmitting}
              className="h-11 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium text-xs transition-colors cursor-pointer"
            >
              Cancel
            </button>

            <button
              type="button"
              onClick={handleConfirmTransfer}
              disabled={isSubmitting}
              className="h-11 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-blue-600/30 transition-all cursor-pointer disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Processing...</span>
                </>
              ) : (
                'Confirm & Send'
              )}
            </button>
          </div>
        </div>
      ) : (
        /* SEND INPUT FORM */
        <form onSubmit={handleReview} className="p-6 rounded-3xl bg-[#0f172a] border border-slate-800 space-y-4 shadow-xl">
          {/* Recipient Input */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-slate-300">Recipient Wallet ID</label>
              <button
                type="button"
                onClick={() => setShowScanner(true)}
                className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 font-medium transition-colors"
              >
                <QrCode className="w-3.5 h-3.5" />
                <span>Scan QR</span>
              </button>
            </div>

            <div className="relative">
              <input
                type="text"
                value={recipientInput}
                onChange={(e) => setRecipientInput(e.target.value.toUpperCase())}
                placeholder="e.g. CP-8349-2194"
                required
                className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-700/80 rounded-xl text-sm font-mono text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors uppercase"
              />

              {isVerifyingRecipient && (
                <div className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400">
                  <Loader2 className="w-4 h-4 animate-spin" />
                </div>
              )}
            </div>

            {/* Recipient Verification Status */}
            {verifiedRecipient && (
              <div className="mt-2 p-2 rounded-lg bg-emerald-950/30 border border-emerald-900/60 flex items-center gap-2 text-xs text-emerald-300">
                <UserCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>
                  Recipient verified: <strong>{verifiedRecipient.fullName}</strong> (@{verifiedRecipient.username})
                </span>
              </div>
            )}

            {recipientError && (
              <div className="mt-2 p-2 rounded-lg bg-rose-950/30 border border-rose-900/60 text-xs text-rose-300">
                {recipientError}
              </div>
            )}
          </div>

          {/* Amount Input with Transaction Limit Display */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-slate-300">Amount (Virtual Coins)</label>
              <span className="text-xs font-semibold text-slate-400">
                Max Limit: <span className="text-cyan-400 font-mono">{maxTxLimit} coins</span>
              </span>
            </div>

            <div className="relative">
              <input
                type="number"
                step="1"
                min="1"
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
                placeholder="Enter coin amount (e.g. 50)"
                required
                className={`w-full px-3.5 py-2.5 bg-slate-900 border rounded-xl text-base font-mono tabular-nums text-white placeholder-slate-500 focus:outline-none transition-colors ${
                  isOverLimit || isInsufficient
                    ? 'border-rose-500 focus:border-rose-500'
                    : 'border-slate-700/80 focus:border-blue-500'
                }`}
              />

              {/* Quick Amount Chips */}
              <div className="flex gap-2 mt-2">
                {[10, 50, 100, 200].map((amt) => (
                  <button
                    key={amt}
                    type="button"
                    onClick={() => setAmountInput(String(amt))}
                    className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-mono text-slate-300 transition-colors"
                  >
                    {amt}
                  </button>
                ))}
              </div>
            </div>

            {/* MANDATORY SECTION 6 ALERT ON EXCEEDING LIMIT */}
            {isOverLimit && (
              <div className="mt-2.5 p-3 rounded-xl bg-rose-950/50 border border-rose-800/80 flex items-start gap-2.5 text-xs text-rose-200 animate-in fade-in">
                <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <div className="font-semibold">
                  Transfer limit exceeded. The maximum allowed per transaction is {maxTxLimit} coins.
                </div>
              </div>
            )}

            {isInsufficient && !isOverLimit && (
              <div className="mt-2 p-2.5 rounded-xl bg-rose-950/40 border border-rose-900/60 text-xs text-rose-300">
                Insufficient coins. Available balance is {conservativeBalance} coins.
              </div>
            )}

            {isZeroOrNegative && (
              <div className="mt-2 p-2 rounded-xl bg-rose-950/40 border border-rose-900/60 text-xs text-rose-300">
                Please enter a positive whole number of coins.
              </div>
            )}

            <div className="flex items-center justify-between text-[11px] text-slate-400 mt-2">
              <span>Available balance: <strong className="text-white font-mono">{conservativeBalance} coins</strong></span>
              <span>Single transaction cap: <strong className="text-white font-mono">{maxTxLimit}</strong></span>
            </div>
          </div>

          <button
            type="submit"
            disabled={
              isOverLimit ||
              isInsufficient ||
              isZeroOrNegative ||
              !recipientInput.trim() ||
              !amountInput
            }
            className="w-full h-12 bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs rounded-xl shadow-lg shadow-blue-600/30 active:scale-[0.99] transition-all flex items-center justify-center gap-2 mt-2 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ArrowUpRight className="w-4 h-4" />
            <span>Review Transfer</span>
          </button>
        </form>
      )}

      {/* QR Scanner Modal */}
      {showScanner && (
        <QrScanner
          onScanSuccess={(payload) => {
            setRecipientInput(payload.walletId);
            setShowScanner(false);
          }}
          onClose={() => setShowScanner(false)}
          showToast={showToast}
        />
      )}
    </div>
  );
};
