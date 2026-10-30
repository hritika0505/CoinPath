export interface CapacitorConfig {
  appId: string;
  appName: string;
  webDir: string;
  bundledWebRuntime?: boolean;
  server?: {
    cleartext?: boolean;
    androidScheme?: string;
    url?: string;
  };
  android?: {
    allowMixedContent?: boolean;
    captureInput?: boolean;
    webContentsDebuggingEnabled?: boolean;
  };
}

const config: CapacitorConfig = {
  appId: 'com.coinpath.virtualwallet',
  appName: 'CoinPath',
  webDir: 'dist',
  bundledWebRuntime: false,
  server: {
    // Allows loading cleartext HTTP during local development on emulators/LAN
    cleartext: true,
    androidScheme: 'https',
  },
  android: {
    allowMixedContent: true,
    captureInput: true,
    webContentsDebuggingEnabled: true,
  },
};

export default config;
