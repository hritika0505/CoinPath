import React, { useEffect, useState, useRef } from 'react';
import QRCode from 'qrcode';
import { Copy, Check, Share2, Shield, Info, Download, QrCode, ArrowDownLeft, KeyRound, AlertCircle } from 'lucide-react';
import { UserProfile, WalletState, ReceiveQrPayload, OfflinePaymentVoucherPayload } from '../../types/wallet.ts';
import { QrScanner } from '../transfer/QrScanner.tsx';

interface ReceiveCoinsProps {
  user: UserProfile;
  wallet: WalletState;
  showToast: (type: 'success' | 'error' | 'info', message: string, title?: string) => void;
  onVoucherReceived?: (voucher: OfflinePaymentVoucherPayload) => void;
}

export const ReceiveCoins: React.FC<ReceiveCoinsProps> = ({ user, wallet, showToast, onVoucherReceived }) => {
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [showManualModal, setShowManualModal] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [manualError, setManualError] = useState<string | null>(null);

  // Generate QR payload
  const qrPayload: ReceiveQrPayload = {
    type: 'coinpath_receive',
    version: 1,
    walletId: wallet.walletId,
    username: user.username,
  };

  useEffect(() => {
    const payloadStr = JSON.stringify(qrPayload);

    QRCode.toDataURL(payloadStr, {
      width: 320,
      margin: 2,
      color: {
        dark: '#080e1e', // high contrast dark navy
        light: '#ffffff', // crisp white
      },
      errorCorrectionLevel: 'H',
    })
      .then((url) => {
        setQrDataUrl(url);
      })
      .catch((err) => {
        console.error('Failed to generate QR code:', err);
      });
  }, [wallet.walletId, user.username]);

  const handleCopyId = () => {
    navigator.clipboard.writeText(wallet.walletId);
    setCopied(true);
    showToast('success', 'Wallet ID copied to clipboard.');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'CoinPath Virtual Wallet ID',
          text: `Send virtual coins to my CoinPath wallet ID: ${wallet.walletId} (@${user.username})`,
        });
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          handleCopyId();
        }
      }
    } else {
      handleCopyId();
    }
  };

  const handleDownloadQr = () => {
    if (!qrDataUrl) return;
    const link = document.createElement('a');
    link.download = `coinpath-qr-${wallet.walletId}.png`;
    link.href = qrDataUrl;
    link.click();
    showToast('info', 'QR Code image saved.');
  };

  const handleClaimManualVoucher = () => {
    setManualError(null);
    const text = manualCode.trim();
    if (!text) {
      setManualError('Please paste an offline voucher code.');
      return;
    }

    try {
      const parsed = JSON.parse(text);
      if (parsed.type !== 'coinpath_payment_voucher' || !parsed.amount || !parsed.senderWalletId) {
        setManualError('Invalid voucher format. Missing required voucher fields.');
        return;
      }

      if (parsed.receiverWalletId && parsed.receiverWalletId !== wallet.walletId) {
        setManualError(`This voucher is addressed to ${parsed.receiverWalletId}, not your wallet (${wallet.walletId}).`);
        return;
      }

      if (onVoucherReceived) {
        onVoucherReceived(parsed);
      }
      setShowManualModal(false);
      setManualCode('');
      showToast('success', `Claimed voucher for +${parsed.amount} coins from ${parsed.senderWalletId}!`);
    } catch {
      setManualError('Voucher code must be valid JSON text.');
    }
  };

  return (
    <div className="space-y-5 pb-8">
      {/* Title */}
      <div>
        <h2 className="text-xl font-bold text-white tracking-tight">Receive Virtual Coins</h2>
        <p className="text-xs text-slate-400">
          Share your QR code or scan an offline payment voucher from a sender.
        </p>
      </div>

      {/* Offline Voucher Claim Quick Actions */}
      <div className="p-4 rounded-3xl bg-gradient-to-r from-blue-950/60 to-cyan-950/40 border border-blue-800/60 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-cyan-600/20 text-cyan-400 flex items-center justify-center">
              <ArrowDownLeft className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-bold text-white">Receiving an Offline Payment?</h3>
              <p className="text-[11px] text-cyan-300/80">Scan the sender's voucher QR code or enter code</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setShowScanner(true)}
            className="min-h-[42px] px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors shadow-sm cursor-pointer"
          >
            <QrCode className="w-4 h-4" />
            <span>Scan Voucher QR</span>
          </button>

          <button
            type="button"
            onClick={() => setShowManualModal(true)}
            className="min-h-[42px] px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors border border-slate-700 cursor-pointer"
          >
            <KeyRound className="w-4 h-4 text-slate-400" />
            <span>Enter Voucher Code</span>
          </button>
        </div>
      </div>

      {/* QR Code Presentation Card */}
      <div className="p-6 rounded-3xl bg-[#0f172a] border border-slate-800 flex flex-col items-center text-center shadow-2xl">
        <div className="text-xs text-slate-400 mb-4">
          Scan with any CoinPath wallet app
        </div>

        {/* High-Contrast QR Container */}
        <div className="p-4 rounded-2xl bg-white shadow-xl relative group">
          {qrDataUrl ? (
            <img
              src={qrDataUrl}
              alt={`Receive QR code for ${wallet.walletId}`}
              className="w-56 h-56 rounded-lg object-contain"
            />
          ) : (
            <div className="w-56 h-56 flex items-center justify-center text-slate-400">
              <div className="w-6 h-6 border-2 border-slate-300 border-t-blue-600 rounded-full animate-spin" />
            </div>
          )}
        </div>

        {/* Recipient Identifier Details */}
        <div className="mt-5 space-y-1">
          <div className="text-xs text-slate-400">Account: <span className="text-white font-medium">{user.fullName}</span> (@{user.username})</div>
          <div className="text-lg font-bold font-mono text-cyan-400 tracking-wider">
            {wallet.walletId}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="grid grid-cols-3 gap-2.5 w-full mt-6">
          <button
            onClick={handleCopyId}
            className="min-h-[44px] px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 hover:text-white flex items-center justify-center gap-1.5 transition-colors border border-slate-700/80 cursor-pointer"
          >
            {copied ? (
              <>
                <Check className="w-4 h-4 text-emerald-400" />
                <span className="text-emerald-400">Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-4 h-4 text-blue-400" />
                <span>Copy ID</span>
              </>
            )}
          </button>

          <button
            onClick={handleShare}
            className="min-h-[44px] px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 hover:text-white flex items-center justify-center gap-1.5 transition-colors border border-slate-700/80 cursor-pointer"
          >
            <Share2 className="w-4 h-4 text-cyan-400" />
            <span>Share</span>
          </button>

          <button
            onClick={handleDownloadQr}
            className="min-h-[44px] px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 hover:text-white flex items-center justify-center gap-1.5 transition-colors border border-slate-700/80 cursor-pointer"
          >
            <Download className="w-4 h-4 text-slate-400" />
            <span>Save QR</span>
          </button>
        </div>
      </div>

      {/* Instructions & Security Notice */}
      <div className="space-y-3">
        <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-2 text-xs text-slate-300">
          <div className="flex items-center gap-2 text-white font-semibold">
            <Info className="w-4 h-4 text-blue-400" />
            <span>How offline payments work</span>
          </div>
          <p className="leading-relaxed text-slate-400">
            • <strong>Online:</strong> Another user scans your QR code or enters your wallet ID to send coins directly.
          </p>
          <p className="leading-relaxed text-slate-400">
            • <strong>Offline:</strong> If either you or the sender has no network, the sender signs a voucher. Scan their voucher QR code above. Your wallet immediately records the incoming coins, and they automatically settle into your balance once online without rejection!
          </p>
        </div>

        <div className="p-3.5 rounded-2xl bg-blue-950/30 border border-blue-900/50 flex items-start gap-2.5 text-xs text-blue-300">
          <Shield className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
          <span>
            Security guarantee: Your private keys never leave your device. All vouchers use ECDSA P-256 signatures verified by the server upon sync.
          </span>
        </div>
      </div>

      {/* Manual Voucher Code Modal */}
      {showManualModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-[#0f172a] border border-slate-700 rounded-3xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-base font-bold text-white">Enter Offline Voucher Code</h3>
              <button
                type="button"
                onClick={() => {
                  setShowManualModal(false);
                  setManualError(null);
                }}
                className="text-xs text-slate-400 hover:text-white"
              >
                Close
              </button>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              If the sender shared their offline voucher code with you via text, paste the JSON payload below to register the incoming payment:
            </p>

            <textarea
              rows={4}
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
              placeholder='Paste voucher JSON, e.g. {"type":"coinpath_payment_voucher", ...}'
              className="w-full p-3 bg-slate-900 border border-slate-700 rounded-xl text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
            />

            {manualError && (
              <div className="p-2.5 rounded-xl bg-rose-950/50 border border-rose-900/70 text-xs text-rose-300 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{manualError}</span>
              </div>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowManualModal(false);
                  setManualError(null);
                }}
                className="flex-1 h-11 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-300 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleClaimManualVoucher}
                className="flex-1 h-11 rounded-xl bg-blue-600 hover:bg-blue-500 text-xs font-bold text-white transition-colors"
              >
                Claim Voucher
              </button>
            </div>
          </div>
        </div>
      )}

      {/* QR Scanner Modal for Voucher */}
      {showScanner && (
        <QrScanner
          onScanSuccess={(payload) => {
            showToast('info', `Scanned wallet ID ${payload.walletId}`);
            setShowScanner(false);
          }}
          onVoucherScanned={(voucher) => {
            setShowScanner(false);
            if (onVoucherReceived) {
              onVoucherReceived(voucher);
            }
          }}
          onClose={() => setShowScanner(false)}
          showToast={showToast}
        />
      )}
    </div>
  );
};
