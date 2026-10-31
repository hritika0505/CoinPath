import React, { useState } from 'react';
import { Eye, EyeOff, ShieldCheck, Coins, Lock, Mail, User as UserIcon, CheckSquare, Square } from 'lucide-react';
import { apiRequest, setStoredToken } from '../../services/api.ts';
import { generateP256KeyPair, savePrivateKey } from '../../services/crypto.ts';
import { UserProfile, WalletState } from '../../types/wallet.ts';

interface AuthProps {
  onAuthSuccess: (user: UserProfile, wallet: WalletState) => void;
  showToast: (type: 'success' | 'error' | 'info', message: string, title?: string) => void;
}

export const AuthScreens: React.FC<AuthProps> = ({ onAuthSuccess, showToast }) => {
  const [isRegisterMode, setIsRegisterMode] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Form states
  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  const [regFullName, setRegFullName] = useState('');
  const [regUsername, setRegUsername] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirmPassword, setRegConfirmPassword] = useState('');
  const [termsAgreed, setTermsAgreed] = useState(false);

  // Quick helper to fill demo test credentials
  const fillDemoCredentials = (username: string) => {
    setLoginIdentifier(username);
    setLoginPassword('Password123!');
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginIdentifier.trim() || !loginPassword) {
      showToast('error', 'Please enter your username or email, and password.');
      return;
    }

    setIsLoading(true);
    try {
      const res = await apiRequest('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          usernameOrEmail: loginIdentifier.trim(),
          password: loginPassword,
        }),
      });

      if (res.error || !res.data) {
        showToast('error', res.error || 'Login failed. Please check your credentials.');
        setIsLoading(false);
        return;
      }

      setStoredToken(res.data.token);
      showToast('success', `Welcome back, ${res.data.user.fullName}!`, 'Login Successful');
      onAuthSuccess(res.data.user, res.data.wallet);
    } catch (err: any) {
      showToast('error', err.message || 'Network error during login.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validation
    if (!regFullName.trim() || !regUsername.trim() || !regEmail.trim() || !regPassword) {
      showToast('error', 'All fields are required.');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(regEmail.trim())) {
      showToast('error', 'Please enter a valid email address.');
      return;
    }

    if (regPassword.length < 6) {
      showToast('error', 'Password must be at least 6 characters long.');
      return;
    }

    if (regPassword !== regConfirmPassword) {
      showToast('error', 'Passwords do not match. Please re-enter.');
      return;
    }

    if (!termsAgreed) {
      showToast('error', 'Please agree to the educational virtual-wallet terms.');
      return;
    }

    setIsLoading(true);
    try {
      // 1. Generate client-side P-256 ECDSA key pair
      let publicKeySpki: string | null = null;
      try {
        const keyData = await generateP256KeyPair();
        publicKeySpki = keyData.publicKeySpkiBase64;
        savePrivateKey(regUsername.trim(), keyData.privateKeyJwk);
      } catch (cryptoErr) {
        console.warn('P-256 key generation notice:', cryptoErr);
      }

      // 2. Call server registration endpoint
      const res = await apiRequest('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          fullName: regFullName.trim(),
          username: regUsername.trim(),
          email: regEmail.trim(),
          password: regPassword,
          publicKey: publicKeySpki,
        }),
      });

      if (res.error || !res.data) {
        showToast('error', res.error || 'Account creation failed.');
        setIsLoading(false);
        return;
      }

      setStoredToken(res.data.token);
      showToast(
        'success',
        `Account created! Your wallet was initialized with ${res.data.wallet.balance} virtual coins.`,
        'Welcome to CoinPath'
      );
      onAuthSuccess(res.data.user, res.data.wallet);
    } catch (err: any) {
      showToast('error', err.message || 'Registration failed due to a network error.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#080e1e] flex flex-col justify-center px-4 py-8">
      <div className="max-w-md w-full mx-auto space-y-6">
        {/* Brand Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-tr from-blue-600 to-cyan-400 shadow-lg shadow-blue-500/20 mb-1">
            <Coins className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">CoinPath</h1>
          <p className="text-sm text-slate-400">Offline-First Virtual Mobile Wallet</p>

          <div className="pt-1 flex items-center justify-center gap-2 text-xs text-slate-500">
            <span>Educational Prototype</span>
            <span aria-hidden="true">·</span>
            <span>ECDSA P-256 Cryptography</span>
          </div>
        </div>

        {/* Card Container */}
        <div className="bg-[#0f172a] border border-slate-800/90 rounded-2xl p-6 shadow-xl">
          {!isRegisterMode ? (
            /* LOGIN FORM */
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <h2 className="text-lg font-semibold text-white">Sign In</h2>
                <span className="text-xs text-slate-400">Protected Session</span>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Username or Email
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
                    <UserIcon className="w-4 h-4" />
                  </div>
                  <input
                    type="text"
                    value={loginIdentifier}
                    onChange={(e) => setLoginIdentifier(e.target.value)}
                    placeholder="e.g. alice or alice@example.com"
                    autoComplete="username"
                    required
                    className="w-full pl-9 pr-3 py-2.5 bg-slate-900 border border-slate-700/80 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Password
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
                    <Lock className="w-4 h-4" />
                  </div>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder="Enter your password"
                    autoComplete="current-password"
                    required
                    className="w-full pl-9 pr-10 py-2.5 bg-slate-900 border border-slate-700/80 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-500 hover:text-slate-300 min-w-[40px] justify-center"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full h-11 bg-blue-600 hover:bg-blue-500 text-white font-medium text-sm rounded-xl shadow-lg shadow-blue-600/20 active:scale-[0.99] transition-all flex items-center justify-center gap-2 mt-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  'Sign In'
                )}
              </button>

              {/* Demo user shortcuts */}
              <div className="pt-2">
                <p className="text-[11px] text-slate-400 mb-1.5 text-center">
                  Quick test account? Register below or try:
                </p>
                <div className="flex gap-2 justify-center">
                  <button
                    type="button"
                    onClick={() => fillDemoCredentials('alice')}
                    className="px-2.5 py-1 text-[11px] bg-slate-800 hover:bg-slate-700 text-blue-300 rounded-lg border border-slate-700 transition-colors"
                  >
                    Fill Alice
                  </button>
                  <button
                    type="button"
                    onClick={() => fillDemoCredentials('bob')}
                    className="px-2.5 py-1 text-[11px] bg-slate-800 hover:bg-slate-700 text-blue-300 rounded-lg border border-slate-700 transition-colors"
                  >
                    Fill Bob
                  </button>
                </div>
              </div>

              <div className="pt-4 text-center border-t border-slate-800">
                <p className="text-xs text-slate-400">
                  Don't have an account?{' '}
                  <button
                    type="button"
                    onClick={() => setIsRegisterMode(true)}
                    className="text-blue-400 hover:text-blue-300 font-semibold transition-colors"
                  >
                    Create Account
                  </button>
                </p>
              </div>
            </form>
          ) : (
            /* REGISTER FORM */
            <form onSubmit={handleRegister} className="space-y-3.5">
              <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <h2 className="text-lg font-semibold text-white">Create Account</h2>
                <div className="flex items-center gap-1 text-[11px] text-emerald-400 font-medium">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>500 Coins Granted</span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Full Name
                </label>
                <input
                  type="text"
                  value={regFullName}
                  onChange={(e) => setRegFullName(e.target.value)}
                  placeholder="e.g. Alice Walker"
                  required
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700/80 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Username
                  </label>
                  <input
                    type="text"
                    value={regUsername}
                    onChange={(e) => setRegUsername(e.target.value)}
                    placeholder="e.g. alice"
                    required
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700/80 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Email
                  </label>
                  <input
                    type="email"
                    value={regEmail}
                    onChange={(e) => setRegEmail(e.target.value)}
                    placeholder="alice@mail.com"
                    required
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700/80 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Password (min 6 characters)
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={regPassword}
                    onChange={(e) => setRegPassword(e.target.value)}
                    placeholder="Create secure password"
                    required
                    className="w-full pl-3 pr-10 py-2 bg-slate-900 border border-slate-700/80 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-500 hover:text-slate-300 min-w-[36px] justify-center"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Confirm Password
                </label>
                <div className="relative">
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={regConfirmPassword}
                    onChange={(e) => setRegConfirmPassword(e.target.value)}
                    placeholder="Re-enter password"
                    required
                    className="w-full pl-3 pr-10 py-2 bg-slate-900 border border-slate-700/80 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-500 hover:text-slate-300 min-w-[36px] justify-center"
                  >
                    {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Virtual Wallet Terms Agreement */}
              <div
                onClick={() => setTermsAgreed(!termsAgreed)}
                className="flex items-start gap-2.5 pt-1 cursor-pointer select-none"
              >
                <div className="mt-0.5 text-blue-400">
                  {termsAgreed ? (
                    <CheckSquare className="w-4 h-4" />
                  ) : (
                    <Square className="w-4 h-4 text-slate-600" />
                  )}
                </div>
                <p className="text-xs text-slate-400 leading-tight">
                  I agree to the CoinPath educational prototype terms. Virtual coins hold no fiat value and are for simulation purposes only.
                </p>
              </div>

              {/* Initial balance note */}
              <div className="p-2.5 rounded-xl bg-blue-950/40 border border-blue-900/60 flex items-center gap-2 text-xs text-blue-300">
                <Coins className="w-4 h-4 text-cyan-400 shrink-0" />
                <span>
                  Initial virtual balance: <strong>500 coins</strong> automatically provisioned to your unique wallet ID.
                </span>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full h-11 bg-blue-600 hover:bg-blue-500 text-white font-medium text-sm rounded-xl shadow-lg shadow-blue-600/20 active:scale-[0.99] transition-all flex items-center justify-center gap-2 mt-2 cursor-pointer disabled:opacity-50"
              >
                {isLoading ? (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  'Create Account'
                )}
              </button>

              <div className="pt-3 text-center border-t border-slate-800">
                <p className="text-xs text-slate-400">
                  Already have an account?{' '}
                  <button
                    type="button"
                    onClick={() => setIsRegisterMode(false)}
                    className="text-blue-400 hover:text-blue-300 font-semibold transition-colors"
                  >
                    Back to Sign In
                  </button>
                </p>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
