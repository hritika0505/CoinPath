import React, { useState } from 'react';
import { Smartphone, X, Copy, Check, Terminal, ExternalLink, ShieldCheck } from 'lucide-react';

interface AndroidGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AndroidGuideModal: React.FC<AndroidGuideModalProps> = ({ isOpen, onClose }) => {
  const [copiedSection, setCopiedSection] = useState<string | null>(null);

  if (!isOpen) return null;

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSection(id);
    setTimeout(() => setCopiedSection(null), 2000);
  };

  const powershellInstallCommands = `# 1. Install Capacitor dependencies
npm install @capacitor/core @capacitor/cli @capacitor/android

# 2. Build Vite production bundle
npm run build

# 3. Initialize & add Android platform
npx cap init CoinPath com.coinpath.virtualwallet --web-dir dist
npx cap add android

# 4. Sync web assets into Android project
npx cap sync android

# 5. Open in Android Studio
npx cap open android`;

  const apkBuildCommands = `# Inside the android/ directory in terminal or via Gradle:
cd android
./gradlew assembleDebug

# Output APK path:
# android/app/build/outputs/apk/debug/app-debug.apk`;

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="max-w-lg w-full bg-[#0f172a] border border-slate-700 rounded-3xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto space-y-5">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Smartphone className="w-5 h-5 text-cyan-400" />
            <h3 className="text-base font-bold text-white">Android Capacitor & APK Guide</h3>
          </div>
          <button
            onClick={onClose}
            className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-full bg-slate-800 text-slate-400 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Network & Host Differences */}
        <div className="p-4 rounded-2xl bg-blue-950/40 border border-blue-900/60 space-y-2 text-xs">
          <div className="font-bold text-blue-300 flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-cyan-400" />
            <span>Important: Mobile Backend Host Routing</span>
          </div>
          <p className="text-slate-300 leading-relaxed">
            When running on Android, <code className="text-cyan-300">localhost</code> refers to the phone itself, NOT your development computer!
          </p>
          <ul className="list-disc pl-4 space-y-1 text-slate-400">
            <li><strong>Browser:</strong> Uses relative <code className="text-slate-300">/api</code> directly.</li>
            <li><strong>Android Emulator:</strong> Use <code className="text-cyan-300">http://10.0.2.2:3000</code> to access your PC host.</li>
            <li><strong>Physical Android Phone:</strong> Ensure phone and PC are on the same Wi-Fi, then enter your PC's LAN IP (e.g. <code className="text-cyan-300">http://192.168.1.100:3000</code>) in Settings.</li>
            <li><strong>Production Cloud:</strong> Use your deployed HTTPS backend URL.</li>
          </ul>
        </div>

        {/* PowerShell Setup Commands */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
            <span className="flex items-center gap-1.5">
              <Terminal className="w-4 h-4 text-slate-400" />
              PowerShell Commands (Capacitor Setup)
            </span>
            <button
              onClick={() => copyToClipboard(powershellInstallCommands, 'setup')}
              className="text-blue-400 hover:text-blue-300 flex items-center gap-1 text-[11px]"
            >
              {copiedSection === 'setup' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedSection === 'setup' ? 'Copied' : 'Copy Commands'}</span>
            </button>
          </div>

          <pre className="p-3 bg-slate-950 border border-slate-800 rounded-xl text-[11px] font-mono text-cyan-300 overflow-x-auto">
            {powershellInstallCommands}
          </pre>
        </div>

        {/* Android Manifest Permissions */}
        <div className="space-y-2">
          <div className="text-xs font-semibold text-slate-300">
            Android Permissions (android/app/src/main/AndroidManifest.xml)
          </div>
          <pre className="p-3 bg-slate-950 border border-slate-800 rounded-xl text-[11px] font-mono text-slate-300 overflow-x-auto">
{`<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.CAMERA" />
<uses-feature android:name="android.hardware.camera" android:required="false" />`}
          </pre>
        </div>

        {/* Generate Debug APK */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
            <span>Generate Debug APK with Gradle</span>
            <button
              onClick={() => copyToClipboard(apkBuildCommands, 'apk')}
              className="text-blue-400 hover:text-blue-300 flex items-center gap-1 text-[11px]"
            >
              {copiedSection === 'apk' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedSection === 'apk' ? 'Copied' : 'Copy'}</span>
            </button>
          </div>

          <pre className="p-3 bg-slate-950 border border-slate-800 rounded-xl text-[11px] font-mono text-emerald-300 overflow-x-auto">
            {apkBuildCommands}
          </pre>
        </div>

        <button
          onClick={onClose}
          className="w-full h-11 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs transition-colors cursor-pointer"
        >
          Close Guide
        </button>
      </div>
    </div>
  );
};
