/**
 * API client for CoinPath
 * Supports configurable backend host for Android physical device / emulator testing
 */

const TOKEN_KEY = 'coinpath_auth_token';
const API_BASE_KEY = 'coinpath_custom_api_url';

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string | null) {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

export function getApiBaseUrl(): string {
  const custom = localStorage.getItem(API_BASE_KEY);
  if (custom && custom.trim().length > 0) {
    return custom.trim().replace(/\/$/, '');
  }
  // If running inside Capacitor Android (where protocol is capacitor: or file:), default to deployed or local IP
  if (typeof window !== 'undefined' && (window.location.protocol === 'capacitor:' || window.location.protocol === 'file:')) {
    return 'http://10.0.2.2:3000'; // Standard Android emulator host loopback
  }
  return '';
}

export function setCustomApiBaseUrl(url: string) {
  if (url) {
    localStorage.setItem(API_BASE_KEY, url.trim().replace(/\/$/, ''));
  } else {
    localStorage.removeItem(API_BASE_KEY);
  }
}

export async function apiRequest<T = any>(
  endpoint: string,
  options: RequestInit = {}
): Promise<{ data?: T; error?: string; status: number }> {
  const token = getStoredToken();
  const headers = new Headers(options.headers || {});

  headers.set('Content-Type', 'application/json');
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const baseUrl = getApiBaseUrl();
  const fullUrl = `${baseUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;

  try {
    const res = await fetch(fullUrl, {
      ...options,
      headers,
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      return {
        error: data.error || `Server responded with status ${res.status}`,
        status: res.status,
      };
    }

    return { data, status: res.status };
  } catch (err: any) {
    console.warn('[API] Network/request error for', endpoint, err);
    return {
      error: err.message || 'Network error: could not connect to CoinPath server.',
      status: 0,
    };
  }
}
