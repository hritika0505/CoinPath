import React, { useEffect, useState, useRef } from 'react';
import QRCode from 'qrcode';
import { Copy, Check, Share2, Shield, Info, Download } from 'lucide-react';
import { UserProfile, WalletState, ReceiveQrPayload } from '../../types/wallet.ts';

interface ReceiveCoinsProps {
  user: UserProfile;
  wallet: WalletState;
  showToast: (type: 'success' | 'error' | 'info', message: string, title?: string) => void;
}

export const ReceiveCoins: React.FC<ReceiveCoinsProps> = ({ user, wallet, showToast }) => {
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

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

  return (
    <div className="space-y-5 pb-8">
      {/* Title */}
      <div>
        <h2 className="text-xl font-bold text-white tracking-tight">Receive Virtual Coins</h2>
        <p className="text-xs text-slate-400">
          Share your QR code or unique wallet ID to receive virtual coins.
        </p>
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
            <span>How it works</span>
          </div>
          <p className="leading-relaxed text-slate-400">
            1. Another CoinPath user opens <strong>Scan QR</strong> or <strong>Send</strong>.
          </p>
          <p className="leading-relaxed text-slate-400">
            2. They point their camera at this QR code or type your wallet ID.
          </p>
          <p className="leading-relaxed text-slate-400">
            3. They choose the transfer amount (up to 200 virtual coins) and confirm.
          </p>
        </div>

        <div className="p-3.5 rounded-2xl bg-blue-950/30 border border-blue-900/50 flex items-start gap-2.5 text-xs text-blue-300">
          <Shield className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
          <span>
            Security guarantee: This QR code contains only your public wallet identifier. Your private keys and account passwords are never stored in or transmitted via QR codes.
          </span>
        </div>
      </div>
    </div>
  );
};
