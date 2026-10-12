window.COINPATH_CONFIG = {
  // When running locally with Express or FastAPI, relative '/api' or empty string uses the same origin.
  // Can be configured to 'http://10.0.2.2:3000' for Android Emulator or custom host.
  apiBase: window.location.origin ? window.location.origin + '/api' : '/api'
};
