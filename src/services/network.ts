type NetworkListener = (isOnline: boolean) => void;

class NetworkMonitor {
  private online: boolean = typeof navigator !== 'undefined' ? navigator.onLine : true;
  private listeners: Set<NetworkListener> = new Set();

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.handleStatusChange(true));
      window.addEventListener('offline', () => this.handleStatusChange(false));
    }
  }

  private handleStatusChange(status: boolean) {
    this.online = status;
    this.listeners.forEach((listener) => {
      try {
        listener(status);
      } catch (err) {
        console.warn('Network listener error:', err);
      }
    });
  }

  public isOnline(): boolean {
    return this.online;
  }

  public subscribe(listener: NetworkListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export const networkMonitor = new NetworkMonitor();
