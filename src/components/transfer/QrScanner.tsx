import React, { useEffect, useRef, useState, useCallback } from 'react';
import jsQR from 'jsqr';
import {
  Camera,
  AlertCircle,
  X,
  Upload,
  CheckCircle2,
  RefreshCw,
  Loader2,
  ChevronDown,
  Video,
  ShieldAlert,
  Play,
  RotateCcw,
} from 'lucide-react';
import { ReceiveQrPayload, OfflinePaymentVoucherPayload } from '../../types/wallet.ts';

interface QrScannerProps {
  onScanSuccess: (payload: ReceiveQrPayload) => void;
  onVoucherScanned?: (voucher: OfflinePaymentVoucherPayload) => void;
  onClose: () => void;
  showToast: (type: 'success' | 'error' | 'info', message: string, title?: string) => void;
}

interface VideoDevice {
  deviceId: string;
  label: string;
}

export const QrScanner: React.FC<QrScannerProps> = ({ onScanSuccess, onVoucherScanned, onClose, showToast }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const isMountedRef = useRef<boolean>(true);
  const isScanningRef = useRef<boolean>(false);
  const sessionCounterRef = useRef<number>(0);

  const [cameraStatus, setCameraStatus] = useState<'prompt' | 'initializing' | 'active' | 'error'>('initializing');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorName, setErrorName] = useState<string | null>(null);
  const [hasScanned, setHasScanned] = useState(false);
  const [videoDimensions, setVideoDimensions] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const [availableDevices, setAvailableDevices] = useState<VideoDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');

  // Cleanly stops all tracks and animation frames
  const stopCamera = useCallback(() => {
    isScanningRef.current = false;

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch (e) {
          console.warn('Error stopping track:', e);
        }
      });
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  // Fetch list of available video cameras
  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = devices
        .filter((d) => d.kind === 'videoinput')
        .map((d, index) => ({
          deviceId: d.deviceId,
          label: d.label || `Camera ${index + 1}`,
        }));
      setAvailableDevices(videoInputs);
    } catch (e) {
      console.warn('enumerateDevices error:', e);
    }
  }, []);

  // Process decoded QR text
  const handleDecodedText = useCallback((text: string) => {
    try {
      let payload: any;
      try {
        payload = JSON.parse(text);
      } catch {
        if (/^CP-\d{4}-\d{4}$/.test(text.trim())) {
          payload = {
            type: 'coinpath_receive',
            version: 1,
            walletId: text.trim(),
          };
        } else {
          showToast('error', 'Scanned code is not a valid CoinPath QR code.');
          return;
        }
      }

      // 1. Check for Offline Payment Voucher payload (Sender paying Receiver while offline)
      if (payload.type === 'coinpath_payment_voucher') {
        if (!payload.txId || !payload.senderWalletId || !payload.amount) {
          showToast('error', 'Malformed payment receipt payload.');
          return;
        }

        setHasScanned(true);
        stopCamera();
        showToast('success', `Payment voucher received! +${payload.amount} coins pending sync.`);
        if (onVoucherScanned) {
          onVoucherScanned(payload);
        } else {
          onScanSuccess({
            type: 'coinpath_receive',
            version: 1,
            walletId: payload.senderWalletId,
            username: payload.senderName,
          });
        }
        return;
      }

      // 2. Check for Standard Receive QR payload (Recipient address)
      if (payload.type !== 'coinpath_receive' || !payload.walletId) {
        showToast('error', 'Malformed CoinPath QR code format.');
        return;
      }

      setHasScanned(true);
      stopCamera();
      showToast('success', `Scanned recipient wallet: ${payload.walletId}`);
      onScanSuccess(payload);
    } catch {
      showToast('error', 'Failed to process QR code content.');
    }
  }, [onScanSuccess, onVoucherScanned, showToast, stopCamera]);

  // Frame scanning loop using jsqr
  const scanFrame = useCallback(() => {
    if (!isMountedRef.current || !isScanningRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (video && canvas && streamRef.current) {
      if (
        video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
        video.videoWidth > 0 &&
        video.videoHeight > 0
      ) {
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            setVideoDimensions({ width: video.videoWidth, height: video.videoHeight });
          }

          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: 'dontInvert',
          });

          if (code && code.data) {
            handleDecodedText(code.data);
            return;
          }
        }
      }
    }

    animationFrameRef.current = requestAnimationFrame(scanFrame);
  }, [handleDecodedText]);

  // Start camera with aggressive fallbacks and permission recovery
  const startCamera = useCallback(async (forcedDeviceId?: string, forcedFacing?: 'environment' | 'user') => {
    const sessionId = ++sessionCounterRef.current;
    stopCamera();
    setCameraStatus('initializing');
    setErrorMessage(null);
    setErrorName(null);

    // Check mediaDevices support
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      if (isMountedRef.current && sessionCounterRef.current === sessionId) {
        setCameraStatus('error');
        setErrorName('NotSupportedError');
        setErrorMessage('Camera access is not supported by your browser or environment. Make sure HTTPS is used.');
      }
      return;
    }

    let stream: MediaStream | null = null;
    const targetDeviceId = forcedDeviceId !== undefined ? forcedDeviceId : selectedDeviceId;
    const targetFacing = forcedFacing !== undefined ? forcedFacing : facingMode;

    // Constraint Strategy Matrix:
    // 1. Exact device ID (if selected)
    // 2. Facing mode: ideal (environment/user)
    // 3. Simple video: true (universal Chrome/USB webcam fallback)
    const constraintAttempts: MediaStreamConstraints[] = [];

    if (targetDeviceId) {
      constraintAttempts.push({
        video: { deviceId: { exact: targetDeviceId } },
        audio: false,
      });
    }

    constraintAttempts.push({
      video: {
        facingMode: { ideal: targetFacing },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    });

    constraintAttempts.push({
      video: {
        facingMode: targetFacing,
      },
      audio: false,
    });

    constraintAttempts.push({
      video: true,
      audio: false,
    });

    let lastError: any = null;

    for (let i = 0; i < constraintAttempts.length; i++) {
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraintAttempts[i]);
        if (stream && stream.active) {
          break; // successfully acquired stream
        }
      } catch (err: any) {
        lastError = err;
        console.warn(`[QrScanner] Attempt ${i + 1} with constraints:`, constraintAttempts[i], 'failed with:', err.name);
        // If permission explicitly denied by user, don't keep hammering
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          break;
        }
      }
    }

    if (!isMountedRef.current || sessionCounterRef.current !== sessionId) {
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
      return;
    }

    if (!stream) {
      setCameraStatus('error');
      const errName = lastError?.name || 'CameraUnavailable';
      setErrorName(errName);

      if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError') {
        setErrorMessage('Camera permission was denied. Click "Request Camera Permission" or allow camera in Chrome address bar lock icon.');
      } else if (errName === 'NotReadableError' || errName === 'TrackStartError') {
        setErrorMessage('Webcam is locked or already in use by another program (Zoom, Meet, or another Chrome tab). Close other video apps and retry.');
      } else if (errName === 'NotFoundError' || errName === 'DevicesNotFoundError') {
        setErrorMessage('No camera hardware found on this system. You can upload a QR image from your gallery below.');
      } else {
        setErrorMessage(lastError?.message || 'Unable to open camera stream. Please try again.');
      }
      return;
    }

    try {
      const videoTracks = stream.getVideoTracks();
      if (!videoTracks || videoTracks.length === 0) {
        throw new Error('Camera stream contains no active video tracks.');
      }

      const primaryTrack = videoTracks[0];
      if (primaryTrack.readyState === 'ended') {
        throw new Error('Camera track has ended.');
      }

      primaryTrack.onended = () => {
        if (isMountedRef.current && sessionCounterRef.current === sessionId) {
          setCameraStatus('error');
          setErrorName('TrackEnded');
          setErrorMessage('Camera stream was closed or switched off.');
        }
      };

      streamRef.current = stream;

      // Update available video devices
      await refreshDevices();

      const video = videoRef.current;
      if (!video) {
        throw new Error('Video element reference is not found in DOM.');
      }

      video.muted = true;
      video.defaultMuted = true;
      video.playsInline = true;
      video.autoplay = true;
      video.setAttribute('playsinline', 'true');
      video.setAttribute('webkit-playsinline', 'true');
      video.setAttribute('autoplay', 'true');
      video.setAttribute('muted', 'true');

      video.srcObject = stream;

      // Wait for video playback to start
      await new Promise<void>((resolve) => {
        let isDone = false;

        const checkDimensions = () => {
          if (isDone) return;
          if (video.videoWidth > 0 && video.videoHeight > 0) {
            isDone = true;
            cleanup();
            resolve();
          }
        };

        const onLoadedMetadata = () => { checkDimensions(); };
        const onCanPlay = () => { checkDimensions(); };
        const onPlaying = () => { checkDimensions(); };

        const cleanup = () => {
          video.removeEventListener('loadedmetadata', onLoadedMetadata);
          video.removeEventListener('canplay', onCanPlay);
          video.removeEventListener('playing', onPlaying);
        };

        video.addEventListener('loadedmetadata', onLoadedMetadata);
        video.addEventListener('canplay', onCanPlay);
        video.addEventListener('playing', onPlaying);

        if (video.readyState >= HTMLMediaElement.HAVE_METADATA && video.videoWidth > 0) {
          isDone = true;
          cleanup();
          resolve();
          return;
        }

        setTimeout(() => {
          if (!isDone) {
            isDone = true;
            cleanup();
            resolve();
          }
        }, 1500);
      });

      if (!isMountedRef.current || sessionCounterRef.current !== sessionId) {
        return;
      }

      try {
        const playPromise = video.play();
        if (playPromise !== undefined) {
          await playPromise;
        }
      } catch (playErr: any) {
        if (playErr.name !== 'AbortError') {
          console.warn('[QrScanner] video.play() warning:', playErr);
        }
      }

      if (isMountedRef.current && sessionCounterRef.current === sessionId) {
        setCameraStatus('active');
        isScanningRef.current = true;
        setVideoDimensions({ width: video.videoWidth, height: video.videoHeight });
        scanFrame();
      }
    } catch (finalErr: any) {
      console.error('[QrScanner] Setup error:', finalErr);
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
      if (isMountedRef.current && sessionCounterRef.current === sessionId) {
        setCameraStatus('error');
        setErrorName(finalErr.name || 'SetupError');
        setErrorMessage(finalErr.message || 'Failed to render camera stream.');
      }
    }
  }, [facingMode, refreshDevices, scanFrame, selectedDeviceId, stopCamera]);

  // Toggle between front and back camera
  const handleToggleFacing = () => {
    const nextFacing = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(nextFacing);
    startCamera(undefined, nextFacing);
  };

  // File upload QR scanner fallback
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0);
          const imageData = ctx.getImageData(0, 0, img.width, img.height);
          const code = jsQR(imageData.data, imageData.width, imageData.height);
          if (code && code.data) {
            handleDecodedText(code.data);
          } else {
            showToast('error', 'No valid CoinPath QR code found in uploaded image.');
          }
        }
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  useEffect(() => {
    isMountedRef.current = true;
    startCamera();

    return () => {
      isMountedRef.current = false;
      stopCamera();
    };
  }, [startCamera, stopCamera]);

  return (
    <div className="fixed inset-0 z-50 bg-[#080e1e]/98 backdrop-blur-xl flex flex-col justify-between p-4">
      {/* Top Header */}
      <div className="flex items-center justify-between text-white pt-safe">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-blue-600/30 text-blue-400 flex items-center justify-center border border-blue-500/40">
            <Camera className="w-4 h-4" />
          </div>
          <div>
            <h3 className="font-bold text-sm leading-tight">CoinPath QR Scanner</h3>
            <span className="text-[11px] text-slate-400">Position recipient QR code</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {cameraStatus === 'active' && (
            <button
              onClick={handleToggleFacing}
              className="min-h-[40px] px-2.5 py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-medium flex items-center gap-1.5 border border-slate-700/80 cursor-pointer transition-colors"
              title="Switch Camera (Front/Back)"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Flip</span>
            </button>
          )}

          <button
            onClick={() => {
              stopCamera();
              onClose();
            }}
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl bg-slate-800/80 text-slate-300 hover:text-white border border-slate-700/80 transition-colors cursor-pointer"
            aria-label="Close scanner"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Camera Selection Dropdown (if multiple video devices detected) */}
      {availableDevices.length > 1 && (
        <div className="max-w-xs w-full mx-auto mt-2">
          <div className="relative">
            <select
              value={selectedDeviceId}
              onChange={(e) => {
                const newId = e.target.value;
                setSelectedDeviceId(newId);
                startCamera(newId);
              }}
              className="w-full appearance-none bg-slate-900 border border-slate-700 text-slate-200 text-xs rounded-xl px-3 py-2 pr-8 focus:outline-none focus:border-blue-500"
            >
              <option value="">Default / Auto Webcam</option>
              {availableDevices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label}
                </option>
              ))}
            </select>
            <ChevronDown className="w-4 h-4 text-slate-400 absolute right-2.5 top-2.5 pointer-events-none" />
          </div>
        </div>
      )}

      {/* Main Viewport & Video Frame */}
      <div className="flex-1 flex flex-col items-center justify-center relative my-3">
        <div className="relative w-full max-w-xs aspect-square rounded-3xl overflow-hidden border-2 border-blue-500/80 shadow-2xl bg-black flex items-center justify-center">
          {/* Always rendered in DOM to guarantee ref attachment */}
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={`w-full h-full object-cover transition-opacity duration-300 ${
              cameraStatus === 'active' ? 'opacity-100' : 'opacity-0'
            }`}
          />
          <canvas ref={canvasRef} className="hidden" />

          {/* Initializing Spinner */}
          {cameraStatus === 'initializing' && (
            <div className="absolute inset-0 bg-slate-950 flex flex-col items-center justify-center gap-3 p-4 text-center">
              <Loader2 className="w-8 h-8 text-blue-400 animate-spin" />
              <div className="text-xs text-slate-200 font-semibold">Opening Camera...</div>
              <div className="text-[11px] text-slate-400 max-w-[200px]">
                Click &quot;Allow&quot; on your browser prompt if requested
              </div>
            </div>
          )}

          {/* Camera Error Screen */}
          {cameraStatus === 'error' && (
            <div className="absolute inset-0 bg-slate-950 flex flex-col items-center justify-center p-5 text-center space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-rose-500/20 text-rose-400 flex items-center justify-center mx-auto border border-rose-500/30">
                <AlertCircle className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <div className="text-white font-bold text-sm flex items-center justify-center gap-1.5">
                  <span>Camera Unavailable</span>
                  {errorName && (
                    <span className="text-[10px] text-rose-400 font-mono bg-rose-950/60 px-1.5 py-0.5 rounded border border-rose-900/60">
                      {errorName}
                    </span>
                  )}
                </div>
                <div className="text-xs text-slate-300 leading-relaxed max-w-[240px] mx-auto">
                  {errorMessage || 'Unable to open camera.'}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-col gap-2 w-full pt-2">
                <button
                  type="button"
                  onClick={() => startCamera()}
                  className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer shadow-lg shadow-blue-600/30 active:scale-[0.98]"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Request Permission &amp; Retry</span>
                </button>
              </div>
            </div>
          )}

          {/* Active Target Reticle */}
          {cameraStatus === 'active' && !hasScanned && (
            <div className="absolute inset-0 border-2 border-dashed border-cyan-400/70 rounded-2xl m-6 pointer-events-none flex items-center justify-center">
              <div className="w-full h-0.5 bg-cyan-400/90 shadow-sm animate-pulse" />
            </div>
          )}

          {/* Success Overlay */}
          {hasScanned && (
            <div className="absolute inset-0 bg-emerald-950/90 flex flex-col items-center justify-center gap-2 text-white font-bold animate-in fade-in">
              <CheckCircle2 className="w-10 h-10 text-emerald-400" />
              <span className="text-base">QR Code Recognized!</span>
            </div>
          )}
        </div>

        {/* Live Feedback info */}
        {cameraStatus === 'active' && (
          <div className="mt-3 text-center space-y-1">
            <p className="text-xs text-slate-200 font-medium">
              Scanning active — hold camera steady
            </p>
            {videoDimensions.width > 0 && (
              <p className="text-[10px] text-slate-500 font-mono">
                {videoDimensions.width}×{videoDimensions.height}px ({facingMode})
              </p>
            )}
          </div>
        )}

        {cameraStatus === 'error' && (
          <div className="mt-3 text-center max-w-xs">
            <p className="text-[11px] text-slate-400 leading-relaxed">
              If Chrome is blocking your camera, click the <strong>tune/padlock icon</strong> on the left side of the URL bar and toggle <strong>Camera to &quot;Allow&quot;</strong>.
            </p>
          </div>
        )}
      </div>

      {/* Bottom Actions: Instant Photo/Gallery Scan & Manual Entry */}
      <div className="space-y-2 pb-safe max-w-xs w-full mx-auto">
        <label className="w-full h-11 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer border border-slate-700 transition-colors shadow-sm active:scale-[0.99]">
          <Upload className="w-4 h-4 text-cyan-400" />
          <span>Scan from Photo / Gallery / Screenshot</span>
          <input
            type="file"
            accept="image/*"
            onChange={handleFileUpload}
            className="hidden"
          />
        </label>

        <button
          onClick={() => {
            stopCamera();
            onClose();
          }}
          className="w-full h-10 rounded-xl bg-transparent hover:bg-slate-900 text-slate-400 hover:text-white text-xs font-medium flex items-center justify-center transition-colors cursor-pointer"
        >
          Cancel &amp; Enter ID Manually
        </button>
      </div>
    </div>
  );
};
