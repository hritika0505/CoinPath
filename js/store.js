/*
 * store.js - everything CoinPath knows lives here.
 *
 * Accounts, wallets and transfers are kept in this browser's localStorage.
 * Synchronized with the CoinPath backend when connected.
 * Balances are added up from the transfer list.
 */
(function (root) {
  'use strict';

  var DB_KEY = 'coinpath.db';
  var SESSION_KEY = 'coinpath.session';
  var WELCOME_BONUS = 500;

  // ---------- SHA-256 (plain JS, works on file://, http, and webview) ----------
  function sha256(text) {
    var K = [], H = [], n = 0, c, i;
    function isPrime(x) { for (var d = 2; d * d <= x; d++) if (x % d === 0) return false; return true; }
    function frac(x) { return ((x - Math.floor(x)) * 4294967296) | 0; }
    for (c = 2; n < 64; c++) {
      if (isPrime(c)) {
        if (n < 8) H[n] = frac(Math.pow(c, 1 / 2));
        K[n] = frac(Math.pow(c, 1 / 3));
        n++;
      }
    }
    function rr(v, a) { return (v >>> a) | (v << (32 - a)); }

    var utf = unescape(encodeURIComponent(text));
    var bytes = [];
    for (i = 0; i < utf.length; i++) bytes.push(utf.charCodeAt(i));
    var bitLen = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    for (i = 7; i >= 0; i--) bytes.push(i >= 4 ? 0 : (bitLen >>> (i * 8)) & 255);

    for (var off = 0; off < bytes.length; off += 64) {
      var w = [];
      for (i = 0; i < 16; i++) {
        w[i] = (bytes[off + i * 4] << 24) | (bytes[off + i * 4 + 1] << 16) |
               (bytes[off + i * 4 + 2] << 8) | bytes[off + i * 4 + 3];
      }
      for (i = 16; i < 64; i++) {
        var s0 = rr(w[i - 15], 7) ^ rr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        var s1 = rr(w[i - 2], 17) ^ rr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      var a = H[0], b = H[1], cc = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (i = 0; i < 64; i++) {
        var S1 = rr(e, 6) ^ rr(e, 11) ^ rr(e, 25);
        var ch = (e & f) ^ (~e & g);
        var t1 = (h + S1 + ch + K[i] + w[i]) | 0;
        var S0 = rr(a, 2) ^ rr(a, 13) ^ rr(a, 22);
        var maj = (a & b) ^ (a & cc) ^ (b & cc);
        var t2 = (S0 + maj) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = cc; cc = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + cc) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    var out = '';
    for (i = 0; i < 8; i++) out += ('00000000' + (H[i] >>> 0).toString(16)).slice(-8);
    return out;
  }

  function randomHex(len) {
    var out = '';
    var cryptoObj = root.crypto;
    if (cryptoObj && cryptoObj.getRandomValues) {
      var arr = new Uint8Array(len);
      cryptoObj.getRandomValues(arr);
      for (var i = 0; i < arr.length; i++) out += ('0' + arr[i].toString(16)).slice(-2);
      return out.slice(0, len);
    }
    while (out.length < len) out += Math.floor(Math.random() * 16).toString(16);
    return out;
  }

  function hashPassword(password, salt) {
    var h = sha256(salt + ':' + password);
    for (var i = 0; i < 2000; i++) h = sha256(h + salt);
    return h;
  }

  function emptyDb() { return { users: [], transfers: [] }; }

  function load() {
    try {
      var raw = root.localStorage.getItem(DB_KEY);
      if (!raw) return emptyDb();
      var db = JSON.parse(raw);
      if (!db || !Array.isArray(db.users) || !Array.isArray(db.transfers)) return emptyDb();
      return db;
    } catch (err) {
      return emptyDb();
    }
  }

  function save(db) {
    root.localStorage.setItem(DB_KEY, JSON.stringify(db));
  }

  function newRef() {
    return 'TX' + Date.now().toString(36).toUpperCase() + randomHex(4).toUpperCase();
  }

  function makeWalletId(db) {
    var taken = {};
    db.users.forEach(function (u) { taken[u.walletId] = true; });
    for (var digits = 4; digits <= 8; digits++) {
      var min = Math.pow(10, digits - 1);
      var span = 9 * min;
      var used = db.users.filter(function (u) { return u.walletId.length === 3 + digits; }).length;
      if (used >= span * 0.2) continue;
      for (var tries = 0; tries < 200; tries++) {
        var id = 'CP-' + (min + Math.floor(Math.random() * span));
        if (!taken[id]) return id;
      }
    }
    return 'CP-' + Math.floor(1000 + Math.random() * 9000);
  }

  function balanceOf(db, userId) {
    var total = 0;
    db.transfers.forEach(function (t) {
      if (t.to === userId) total += t.amount;
      if (t.from === userId) total -= t.amount;
    });
    return total;
  }

  function findUser(db, id) {
    for (var i = 0; i < db.users.length; i++) if (db.users[i].id === id) return db.users[i];
    return null;
  }

  function findByWallet(db, walletId) {
    var wanted = String(walletId || '').trim().toUpperCase();
    for (var i = 0; i < db.users.length; i++) if (db.users[i].walletId === wanted) return db.users[i];
    return null;
  }

  function publicUser(u) {
    return { id: u.id, name: u.name, username: u.username, walletId: u.walletId };
  }

  var Store = {
    WELCOME_BONUS: WELCOME_BONUS,
    DB_KEY: DB_KEY,
    SESSION_KEY: SESSION_KEY,
    sha256: sha256,

    passwordProblem: function (pw) {
      if (pw.length < 8) return 'Use at least 8 characters.';
      if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return 'Include at least one letter and one number.';
      if (pw.length > 100) return 'That password is too long.';
      return '';
    },

    signUp: function (input) {
      var errors = {};
      var name = String(input.name || '').trim().replace(/\s+/g, ' ');
      var username = String(input.username || '').trim();
      var password = String(input.password || '');

      if (name.length < 2 || name.length > 40) errors.name = 'Enter your name (2 to 40 characters).';
      if (!/^[A-Za-z0-9_.]{3,20}$/.test(username)) {
        errors.username = '3 to 20 characters: letters, numbers, dot or underscore.';
      }
      var pwProblem = Store.passwordProblem(password);
      if (pwProblem) errors.password = pwProblem;
      if (Object.keys(errors).length) return { ok: false, errors: errors };

      var db = load();
      var key = username.toLowerCase();
      var exists = db.users.some(function (u) { return u.usernameKey === key; });
      if (exists) return { ok: false, errors: { username: 'That username is already taken.' } };

      var salt = randomHex(16);
      var user = {
        id: 'u_' + randomHex(12),
        name: name,
        username: username,
        usernameKey: key,
        salt: salt,
        hash: hashPassword(password, salt),
        walletId: makeWalletId(db),
        created: Date.now()
      };
      db.users.push(user);
      db.transfers.push({
        ref: newRef(), kind: 'bonus', from: null, to: user.id,
        amount: WELCOME_BONUS, note: 'Welcome Bonus', ts: Date.now()
      });
      try {
        save(db);
        root.localStorage.setItem(SESSION_KEY, user.id);
      } catch (err) {
        return { ok: false, errors: { _form: 'This browser would not let CoinPath save your account. Check that storage is not blocked.' } };
      }

      // Also register wallet with backend if available
      try {
        var base = (window.COINPATH_CONFIG && window.COINPATH_CONFIG.apiBase) || '/api';
        fetch(base + '/wallets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wallet_id: user.walletId, name: user.name, balance: WELCOME_BONUS })
        }).catch(function () {});
      } catch (e) {}

      return { ok: true, user: publicUser(user) };
    },

    logIn: function (username, password) {
      var db = load();
      var key = String(username || '').trim().toLowerCase();
      var user = null;
      for (var i = 0; i < db.users.length; i++) if (db.users[i].usernameKey === key) user = db.users[i];
      var good = user && hashPassword(String(password || ''), user.salt) === user.hash;
      if (!good) return { ok: false, errors: { _form: 'Username or password is not right.' } };
      try { root.localStorage.setItem(SESSION_KEY, user.id); } catch (err) {}

      // Sync wallet with backend
      try {
        var base = (window.COINPATH_CONFIG && window.COINPATH_CONFIG.apiBase) || '/api';
        fetch(base + '/wallets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wallet_id: user.walletId, name: user.name, balance: balanceOf(db, user.id) })
        }).catch(function () {});
      } catch (e) {}

      return { ok: true, user: publicUser(user) };
    },

    logOut: function () {
      try { root.localStorage.removeItem(SESSION_KEY); } catch (err) {}
    },

    currentUser: function () {
      var id;
      try { id = root.localStorage.getItem(SESSION_KEY); } catch (err) { return null; }
      if (!id) return null;
      var u = findUser(load(), id);
      return u ? publicUser(u) : null;
    },

    balance: function (userId) {
      return balanceOf(load(), userId);
    },

    lookup: function (walletId) {
      var u = findByWallet(load(), walletId);
      return u ? { name: u.name, walletId: u.walletId } : null;
    },

    history: function (userId) {
      var db = load();
      var names = {};
      db.users.forEach(function (u) { names[u.id] = u; });
      var rows = [];
      db.transfers.forEach(function (t) {
        var dir = t.to === userId ? 'in' : (t.from === userId ? 'out' : null);
        if (!dir) return;
        var other = dir === 'in' ? names[t.from] : names[t.to];
        rows.push({
          ref: t.ref, kind: t.kind, dir: dir, amount: t.amount, note: t.note, ts: t.ts,
          otherName: other ? other.name : (t.kind === 'bonus' ? 'CoinPath' : (t.otherName || 'External User')),
          otherWallet: other ? other.walletId : (t.otherWallet || '')
        });
      });
      rows.sort(function (a, b) { return b.ts - a.ts; });
      return rows;
    },

    recentRecipients: function (userId) {
      var seen = {}, out = [];
      Store.history(userId).forEach(function (r) {
        if (r.dir === 'out' && r.otherWallet && !seen[r.otherWallet]) {
          seen[r.otherWallet] = true;
          out.push({ name: r.otherName, walletId: r.otherWallet });
        }
      });
      return out.slice(0, 4);
    },

    recordExternalTransfer: function (fromWalletId, toWalletId, amount, ref, note, ts) {
      var db = load();
      var sender = findByWallet(db, fromWalletId);
      var receiver = findByWallet(db, toWalletId);
      
      // Prevent duplicate entry in store
      var already = db.transfers.some(function (t) { return t.ref === ref; });
      if (already) return;

      var entry = {
        ref: ref || newRef(),
        kind: 'transfer',
        from: sender ? sender.id : 'ext_' + fromWalletId,
        to: receiver ? receiver.id : 'ext_' + toWalletId,
        otherWallet: sender ? toWalletId : fromWalletId,
        otherName: sender ? (receiver ? receiver.name : toWalletId) : (sender ? sender.name : fromWalletId),
        amount: amount,
        note: note || 'Offline Sync Payment',
        ts: ts || Date.now()
      };
      db.transfers.push(entry);
      save(db);
    },

    transfer: function (fromUserId, toWalletId, amount, note) {
      var db = load();
      var sender = findUser(db, fromUserId);
      if (!sender) return { ok: false, error: 'Please log in again.' };
      var receiver = findByWallet(db, toWalletId);
      if (!receiver) return { ok: false, error: 'No wallet exists with that ID.' };
      if (receiver.id === sender.id) return { ok: false, error: 'You cannot send coins to yourself.' };
      if (!(typeof amount === 'number' && isFinite(amount) && Math.floor(amount) === amount && amount > 0)) {
        return { ok: false, error: 'Enter a whole number of coins above 0.' };
      }
      if (amount > balanceOf(db, sender.id)) {
        return { ok: false, error: 'Not enough coins. Nothing was sent.' };
      }
      var tx = {
        ref: newRef(), kind: 'transfer', from: sender.id, to: receiver.id,
        amount: amount, note: String(note || '').trim().slice(0, 60), ts: Date.now()
      };
      db.transfers.push(tx);
      try {
        save(db);
      } catch (err) {
        return { ok: false, error: 'Could not save the transfer. Nothing was sent.' };
      }

      // Synchronize with backend if online
      if (navigator.onLine) {
        var base = (window.COINPATH_CONFIG && window.COINPATH_CONFIG.apiBase) || '/api';
        fetch(base + '/transactions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tx_id: tx.ref,
            sender: sender.walletId,
            receiver: receiver.walletId,
            amount: amount,
            note: tx.note,
            timestamp: tx.ts,
            status: 'confirmed'
          })
        }).catch(function (e) { console.warn('Online sync queued', e); });
      }

      return {
        ok: true,
        tx: { ref: tx.ref, amount: amount, ts: tx.ts, toName: receiver.name, toWallet: receiver.walletId }
      };
    }
  };

  root.Store = Store;
})(typeof window !== 'undefined' ? window : globalThis);
