/*
 * app.js - CoinPath screens, events and routing.
 * Preserves the original visual identity, theme, and UX while adding:
 * - Safety Dashboard & spending limit controls
 * - In-app and SMS notification center
 * - Idempotent sync and duplicate detection feedback
 * - Real-time audit history
 */
(function () {
  'use strict';

  var S = window.Store;
  var app = document.getElementById('app');
  var dialog = document.getElementById('txDialog');
  var toastEl = document.getElementById('toast');

  var state = {
    auth: 'login',       // login | signup
    welcome: false,      // show the "your wallet ID" screen once after sign up
    view: 'wallet',      // wallet | send | scan | history | safety | notifications
    filter: 'all',       // all | out | in
    step: 'form',        // form | review | done
    draft: null,
    result: null,
    sendError: '',
    busy: false,
    sendMode: 'now',     // now | qr
    qrResult: null,      // { payload, tx } after a payment code is made
    scanResult: null,    // result of reading a scanned code
    localTxs: [],        // QR payments kept on this device (from offlineApi.js)
    safetyData: null,    // statistics from Safety Dashboard
    notifications: [],   // in-app notification list
    offlineLimitDraft: '',
    smsPhoneDraft: localStorage.getItem('coinpath.phone') || '+1 555-0199',
    smsEnabled: localStorage.getItem('coinpath.sms_enabled') !== 'false'
  };

  // ---------- offline / QR payments (js/offlineApi.js) ----------
  var config = window.COINPATH_CONFIG || { apiBase: '/api' };
  var offline = null;          // the offlineApi.js module once it has loaded
  var keyReady = {};           // wallet ids whose signing key has been set up
  var NO_OFFLINE = 'QR payments need js/offlineApi.js. Ensure the file is present in the js folder.';

  var SETTLED = ['accepted', 'duplicate', 'confirmed', 'synced', 'settled', 'done'];

  function wrapLocal(item) {
    var t = (item && item.tx) ? item.tx : item;
    var st = String((item && item.status) || (t && t.status) || '').toLowerCase();
    var kind = 'pending';
    if (st.indexOf('reject') !== -1) kind = 'rejected';
    else if (st === 'duplicate') kind = 'duplicate';
    else if (SETTLED.indexOf(st) !== -1 || (item && item.synced === true)) kind = 'done';
    return { tx: t, kind: kind, reason: (item && item.reason) || (t && t.reason) || '' };
  }

  function localFor(user) {
    var seen = {};
    return state.localTxs.map(wrapLocal).filter(function (x) {
      if (!x.tx || (x.tx.sender !== user.walletId && x.tx.receiver !== user.walletId)) return false;
      if (seen[x.tx.tx_id]) return false;
      seen[x.tx.tx_id] = true;
      return true;
    }).sort(function (a, b) { return (b.tx.timestamp || 0) - (a.tx.timestamp || 0); });
  }

  function pendingTotals(user) {
    var out = 0, inn = 0;
    localFor(user).forEach(function (x) {
      if (x.kind !== 'pending') return;
      if (x.tx.sender === user.walletId) out += x.tx.amount;
      else inn += x.tx.amount;
    });
    return { out: out, inn: inn };
  }

  function available(user) {
    return S.balance(user.id) - pendingTotals(user).out;
  }

  function loadLocal() {
    if (!offline || !offline.listLocalTransactions) return Promise.resolve();
    return Promise.resolve()
      .then(function () { return offline.listLocalTransactions(); })
      .then(function (list) { state.localTxs = Array.isArray(list) ? list : []; })
      .catch(function (err) { console.warn('Could not read local transactions', err); });
  }

  function loadSafetyAndNotifications(user) {
    if (!offline || !user) return Promise.resolve();
    return Promise.all([
      offline.getSafetyDashboardData ? offline.getSafetyDashboardData(user.walletId) : Promise.resolve(null),
      offline.getNotifications ? offline.getNotifications(user.walletId) : Promise.resolve([])
    ]).then(function (results) {
      state.safetyData = results[0];
      state.notifications = results[1] || [];
    }).catch(function (err) {
      console.warn('Could not load safety metrics', err);
    });
  }

  function savePublicKey(walletId, jwk) {
    try {
      var all = JSON.parse(localStorage.getItem('coinpath.pubkeys') || '{}');
      all[walletId] = jwk;
      localStorage.setItem('coinpath.pubkeys', JSON.stringify(all));
    } catch (e) { /* ignore */ }
  }

  function ensureLocalWallet() {
    var user = S.currentUser();
    if (!offline || !user || keyReady[user.walletId]) return Promise.resolve();
    return Promise.resolve().then(function () { return offline.setupLocalWallet(user.walletId); })
      .then(function (jwk) { keyReady[user.walletId] = true; savePublicKey(user.walletId, jwk); })
      .catch(function (err) { console.warn('Could not set up the signing key', err); });
  }

  function afterLogin() {
    var user = S.currentUser();
    ensureLocalWallet()
      .then(loadLocal)
      .then(function () { return loadSafetyAndNotifications(user); })
      .then(function () { if (S.currentUser()) softRender(); });
  }

  function setBadge() {
    var el = document.getElementById('netBadge');
    if (!el) return;
    var on = navigator.onLine !== false;
    el.setAttribute('data-online', on ? 'yes' : 'no');
    el.textContent = on ? 'Online (Connected)' : 'Offline (Safe Mode)';
  }

  function startOffline() {
    var load = window.COINPATH_OFFLINE_LOADER || function () { return import('./offlineApi.js'); };
    Promise.resolve().then(load).then(function (mod) {
      offline = mod;
      mod.initOffline({
        apiBase: config.apiBase,
        badgeEl: document.getElementById('netBadge'),
        onSync: function () {
          var user = S.currentUser();
          loadLocal()
            .then(function () { return loadSafetyAndNotifications(user); })
            .then(function () { softRender(); toast('Sync finished'); });
        }
      });
      return ensureLocalWallet();
    }).then(loadLocal).then(function () {
      return loadSafetyAndNotifications(S.currentUser());
    }).then(function () { softRender(); })
      .catch(function (err) { offline = null; console.warn('offlineApi.js did not load', err); });
  }

  // ---------- QR drawing and scanning ----------
  function qrSvg(text) {
    if (!window.qrcode) return '';
    var levels = ['M', 'L'];
    for (var i = 0; i < levels.length; i++) {
      try {
        var qr = window.qrcode(0, levels[i]);
        qr.addData(text);
        qr.make();
        return qr.createSvgTag({ cellSize: 4, margin: 4, scalable: true });
      } catch (e) { /* try next */ }
    }
    return '';
  }

  var scan = { stream: null, raf: 0 };
  function stopScanner() {
    cancelAnimationFrame(scan.raf);
    if (scan.stream) scan.stream.getTracks().forEach(function (t) { t.stop(); });
    scan.stream = null;
  }

  function startScanner() {
    stopScanner();
    var video = document.getElementById('scanVideo');
    var note = document.getElementById('scanNote');
    if (!video) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      note.textContent = 'Camera not available on this origin. Paste the payment code text below.';
      return;
    }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }).then(function (stream) {
      if (document.getElementById('scanVideo') !== video) { stream.getTracks().forEach(function (t) { t.stop(); }); return; }
      scan.stream = stream;
      video.srcObject = stream;
      video.setAttribute('playsinline', '');
      video.play();
      note.textContent = 'Point camera at a CoinPath payment code.';
      var canvas = document.createElement('canvas');
      var ctx = canvas.getContext('2d', { willReadFrequently: true });
      (function tick() {
        if (video.readyState >= 2 && video.videoWidth) {
          var scale = Math.min(1, 640 / video.videoWidth);
          canvas.width = Math.round(video.videoWidth * scale);
          canvas.height = Math.round(video.videoHeight * scale);
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          var img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          var code = window.jsQR && window.jsQR(img.data, canvas.width, canvas.height, { inversionAttempts: 'dontInvert' });
          if (code && code.data) { stopScanner(); handleScanned(code.data); return; }
        }
        scan.raf = requestAnimationFrame(tick);
      })();
    }).catch(function () {
      note.textContent = 'Camera permission not granted. You can paste the code text below.';
    });
  }

  function handleScanned(raw) {
    var text = String(raw || '').trim();
    var user = S.currentUser();
    if (!text || !user) return;

    if (/^CP-\d{4,8}$/i.test(text)) {
      state.draft = { to: text.toUpperCase(), amount: '', note: '' };
      state.view = 'send'; state.step = 'form'; state.qrResult = null; state.sendError = '';
      state.sendMode = S.lookup(text) ? 'now' : 'qr';
      render();
      toast('Wallet ID scanned: ' + text);
      return;
    }
    if (!offline) { state.scanResult = { ok: false, reason: NO_OFFLINE }; render(); return; }
    Promise.resolve().then(function () { return offline.acceptScannedTransfer(text, user.walletId); })
      .catch(function (err) { return { ok: false, reason: err.message || 'That code could not be processed.' }; })
      .then(function (res) {
        state.scanResult = res || { ok: false, reason: 'No answer from offline module.' };
        return loadLocal().then(function () { return loadSafetyAndNotifications(user); });
      }).then(render);
  }

  function makePaymentCode(user, to, amount) {
    if (!offline) { state.sendError = NO_OFFLINE; render(); return; }
    state.busy = true;
    Promise.resolve().then(function () { return offline.createOfflineTransfer(user.walletId, to, amount); })
      .then(function (res) {
        state.busy = false;
        if (!res || !res.payload) throw new Error('Empty payload returned');
        state.qrResult = res;
        return loadLocal().then(function () { return loadSafetyAndNotifications(user); });
      }).catch(function (err) {
        state.busy = false;
        state.qrResult = null;
        state.sendError = 'Could not create payment code: ' + (err && err.message ? err.message : 'Please check limits and try again.');
      }).then(render);
  }

  // ---------- small helpers ----------
  function esc(s) {
    return String(s || '').replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmt(n) { return Number(n || 0).toLocaleString('en-IN'); }
  function when(ts) {
    if (!ts) return 'Just now';
    var d = new Date(ts);
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) +
      ', ' + d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  }
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(function () { toastEl.classList.remove('show'); }, 2200);
  }
  function copyText(text) {
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); toast('Copied ' + text); } catch (e) { toast('Copy failed'); }
      document.body.removeChild(ta);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast('Copied ' + text); }, fallback);
    } else {
      fallback();
    }
  }
  function rowTitle(r) {
    if (r.kind === 'bonus') return 'Welcome Bonus';
    return (r.dir === 'in' ? 'From ' : 'To ') + (r.otherName || r.otherWallet || 'External');
  }

  // ---------- form helpers ----------
  function field(id, label, attrs, extra) {
    return '<div class="field"><label for="' + id + '">' + label + '</label>' +
      '<input id="' + id + '" name="' + id + '" ' + attrs + '>' + (extra || '') +
      '<p class="err" data-err="' + id + '"></p></div>';
  }

  function showErrors(form, errors) {
    Array.prototype.forEach.call(form.querySelectorAll('[data-err]'), function (el) { el.textContent = ''; });
    Array.prototype.forEach.call(form.querySelectorAll('[aria-invalid]'), function (el) { el.removeAttribute('aria-invalid'); });
    var first = null;
    Object.keys(errors).forEach(function (key) {
      var slot = form.querySelector('[data-err="' + key + '"]');
      if (slot) slot.textContent = errors[key];
      var input = form.elements[key];
      if (input && key !== '_form') {
        input.setAttribute('aria-invalid', 'true');
        if (!first) first = input;
      }
    });
    if (first) first.focus();
  }

  // ---------- views ----------
  function loginForm() {
    return '<form id="loginForm" novalidate>' +
      '<h1>Welcome back</h1><p class="sub">Log in to open your CoinPath wallet.</p>' +
      field('username', 'Username', 'type="text" autocomplete="username" autocapitalize="off" spellcheck="false"') +
      field('password', 'Password', 'type="password" autocomplete="current-password"') +
      '<p class="err form-err" data-err="_form"></p>' +
      '<button class="btn primary wide" type="submit">Log in</button>' +
      '</form>';
  }

  function signupForm() {
    return '<form id="signupForm" novalidate>' +
      '<h1>Create your demo account</h1><p class="sub">You will receive your unique wallet ID and ' + S.WELCOME_BONUS + ' virtual welcome coins.</p>' +
      field('name', 'Full name', 'type="text" autocomplete="name"') +
      field('username', 'Username', 'type="text" autocomplete="username" autocapitalize="off" spellcheck="false"') +
      field('password', 'Password',
        'type="password" autocomplete="new-password"',
        '<div class="meter"><span id="meterBar"></span></div><p class="hint" id="meterText">At least 8 characters with a letter and a number.</p>') +
      field('confirm', 'Confirm password', 'type="password" autocomplete="new-password"') +
      '<label class="check"><input type="checkbox" id="showPw"> Show passwords</label>' +
      '<p class="err form-err" data-err="_form"></p>' +
      '<button class="btn primary wide" type="submit">Create account</button>' +
      '</form>';
  }

  function authView() {
    var login = state.auth === 'login';
    return '<div class="auth">' +
      '<aside class="auth-side">' +
        '<div class="brand big"><i></i>CoinPath</div>' +
        '<p class="lead">Offline Virtual Payments & Double-Spending Safety Architecture.</p>' +
        '<p class="fine">Educational prototype for technology exhibition. Virtual coins only. Demonstrates cryptographic signatures, device spending limits, and idempotent server synchronization.</p>' +
      '</aside>' +
      '<section class="auth-main"><div class="auth-box">' +
        '<div class="seg" role="tablist">' +
          '<button type="button" data-act="authtab" data-tab="login" class="' + (login ? 'on' : '') + '">Log in</button>' +
          '<button type="button" data-act="authtab" data-tab="signup" class="' + (!login ? 'on' : '') + '">Create account</button>' +
        '</div>' +
        (login ? loginForm() : signupForm()) +
      '</div></section></div>';
  }

  function welcomeView(user) {
    return '<div class="auth">' +
      '<aside class="auth-side">' +
        '<div class="brand big"><i></i>CoinPath</div>' +
        '<p class="lead">Account ready, ' + esc(user.name.split(' ')[0]) + '.</p>' +
      '</aside>' +
      '<section class="auth-main"><div class="auth-box">' +
        '<h1>Your wallet ID</h1>' +
        '<p class="sub">Share this wallet ID to receive virtual coins even when offline via QR code scanning.</p>' +
        '<div class="idcard"><span class="wid">' + esc(user.walletId) + '</span>' +
        '<button class="btn ghost" data-act="copy" data-text="' + esc(user.walletId) + '">Copy ID</button></div>' +
        '<p class="sub">' + S.WELCOME_BONUS + ' demo coins credited to your account.</p>' +
        '<button class="btn primary wide" data-act="enter">Open my wallet</button>' +
      '</div></section></div>';
  }

  function shell(user, body) {
    var unreadCount = state.notifications.filter(function (n) { return !n.read; }).length;
    function tab(v, label, badge) {
      return '<button data-act="go" data-view="' + v + '" class="' + (state.view === v ? 'on' : '') + '">' +
        label + (badge ? '<span class="badge-count">' + badge + '</span>' : '') + '</button>';
    }
    return '<header class="top"><div class="wrap">' +
        '<div class="bar"><div class="brand"><i></i>CoinPath</div>' +
        '<div class="who"><span>' + esc(user.name) + ' (' + esc(user.walletId) + ')</span>' +
        '<button class="linkbtn" data-act="logout">Log out</button></div></div>' +
        '<nav class="tabs">' +
          tab('wallet', 'Wallet') +
          tab('send', 'Send') +
          tab('scan', 'Scan') +
          tab('history', 'History') +
          tab('safety', 'Safety Dashboard') +
          tab('notifications', 'Alerts', unreadCount > 0 ? unreadCount : null) +
        '</nav>' +
      '</div></header>' +
      '<main class="wrap">' + body + '</main>' +
      '<footer class="wrap foot">CoinPath Virtual Payment System · Offline Verification with Web Crypto & SQLite. Educational Prototype for College Exhibition.</footer>';
  }

  function txList(rows) {
    if (!rows.length) return '<p class="empty">No transactions yet.</p>';
    return '<ul class="txs">' + rows.map(function (r) {
      return '<li><button class="row" data-act="tx" data-ref="' + esc(r.ref) + '">' +
        '<span class="r-main"><b>' + esc(rowTitle(r)) + '</b><small>' + esc(when(r.ts)) + (r.note ? ' · ' + esc(r.note) : '') + '</small></span>' +
        '<span class="amt ' + r.dir + '">' + (r.dir === 'in' ? '+' : '−') + fmt(r.amount) + ' coins</span>' +
        '</button></li>';
    }).join('') + '</ul>';
  }

  function pendingLine(user) {
    var p = pendingTotals(user);
    if (!p.out && !p.inn) return '';
    var bits = [];
    if (p.inn) bits.push('+' + fmt(p.inn) + ' incoming');
    if (p.out) bits.push('\u2212' + fmt(p.out) + ' outgoing');
    return '<p class="pending-line">Pending Offline Sync: ' + bits.join(', ') + '</p>';
  }

  function receiveBlock(user) {
    var svg = qrSvg(user.walletId);
    return '<section class="block receive">' +
      '<div class="qrbox small">' + (svg || '<p class="fine">QR engine unavailable</p>') + '</div>' +
      '<div><h2>Receive by QR</h2>' +
      '<p class="sub">Show this QR code to the sender. It transfers coins securely offline using cryptographic signatures.</p>' +
      '<div class="actions"><button class="btn ghost-dark small" data-act="go" data-view="scan">Scan payment code</button>' +
      '<button class="btn ghost-dark small" data-act="copy" data-text="' + esc(user.walletId) + '">Copy Wallet ID</button></div></div>' +
      '</section>';
  }

  function walletView(user) {
    var rows = S.history(user.id);
    return '<section class="balance">' +
        '<div><p class="label">Available Balance</p><p class="big-amt">' + fmt(available(user)) + '<span> coins</span></p>' + pendingLine(user) + '</div>' +
        '<div class="idbox"><p class="label">Wallet ID</p><p class="wid">' + esc(user.walletId) + '</p>' +
        '<button class="btn ghost small" data-act="copy" data-text="' + esc(user.walletId) + '">Copy ID</button></div>' +
        '<div class="balance-actions">' +
          '<button class="btn primary" data-act="go" data-view="send">Send Coins</button>' +
          '<button class="btn ghost" data-act="go" data-view="safety">View Safety Dashboard</button>' +
        '</div>' +
      '</section>' + receiveBlock(user) +
      '<section class="block"><div class="block-head"><h2>Recent Activity</h2>' +
        (rows.length > 5 ? '<button class="linkbtn dark" data-act="go" data-view="history">View all</button>' : '') +
      '</div>' + txList(rows.slice(0, 5)) + '</section>';
  }

  function modeSwitch() {
    function m(key, label) {
      return '<button type="button" data-act="mode" data-m="' + key + '" class="' + (state.sendMode === key ? 'on' : '') + '">' + label + '</button>';
    }
    return '<div class="seg">' + m('now', 'Send Online') + m('qr', 'Pay Offline by QR') + '</div>';
  }

  function qrResultView(user) {
    var r = state.qrResult;
    var tx = r.tx || {};
    var svg = qrSvg(r.payload);
    return '<section class="block narrow"><h1>Offline Payment Code</h1>' +
      '<p class="sub">Show this signed code to the receiver. They scan it via <b>Scan</b>. It works completely without internet.</p>' +
      '<div class="qrbox">' + (svg || '<p class="fine">Payload generated. Use the copy button below.</p>') + '</div>' +
      '<dl class="facts">' +
      '<dt>Recipient</dt><dd><span class="mono">' + esc(tx.receiver || '') + '</span></dd>' +
      '<dt>Amount</dt><dd><b>' + fmt(tx.amount || 0) + ' coins</b></dd>' +
      '<dt>Transaction ID</dt><dd class="mono">' + esc(tx.tx_id || '') + '</dd>' +
      '<dt>Status</dt><dd><span class="status pending">Pending Sync</span></dd></dl>' +
      '<p class="fine">Coins remain locally reserved under your Offline Spending Limit until synchronized with the server.</p>' +
      '<details class="codetext"><summary>Show signed payload text</summary>' +
      '<textarea readonly rows="3">' + esc(r.payload) + '</textarea>' +
      '<button class="btn ghost-dark small" data-act="copy" data-text="' + esc(r.payload) + '">Copy payload text</button></details>' +
      '<div class="actions"><button class="btn primary" data-act="go" data-view="wallet">Done</button>' +
      '<button class="btn ghost-dark" data-act="again">Create another payment</button></div></section>';
  }

  function sendView(user) {
    var bal = S.balance(user.id);
    var avail = available(user);
    var d = state.draft || { to: '', amount: '', note: '' };

    if (state.sendMode === 'qr' && state.qrResult) return qrResultView(user);

    if (state.step === 'done' && state.result) {
      var r = state.result;
      return '<section class="block narrow"><h1>Transaction Confirmed</h1>' +
        '<p class="done-line"><b>' + fmt(r.amount) + ' coins</b> sent to ' + esc(r.toName || r.toWallet) + '.</p>' +
        '<dl class="facts"><dt>Reference ID</dt><dd class="mono">' + esc(r.ref) + '</dd>' +
        '<dt>Timestamp</dt><dd>' + esc(when(r.ts)) + '</dd>' +
        '<dt>New Balance</dt><dd>' + fmt(avail) + ' coins</dd></dl>' +
        '<div class="actions"><button class="btn primary" data-act="go" data-view="wallet">Back to wallet</button>' +
        '<button class="btn ghost-dark" data-act="again">Send another</button></div></section>';
    }

    if (state.step === 'review' && state.draft) {
      return '<section class="block narrow"><h1>Confirm Transfer Details</h1>' +
        '<dl class="facts">' +
        '<dt>Recipient</dt><dd>' + esc(d.name || d.to) + ' <span class="mono">(' + esc(d.to) + ')</span></dd>' +
        '<dt>Amount</dt><dd><b>' + fmt(d.amount) + ' coins</b></dd>' +
        (d.note ? '<dt>Note</dt><dd>' + esc(d.note) + '</dd>' : '') +
        '<dt>Balance after</dt><dd>' + fmt(avail - d.amount) + ' coins</dd></dl>' +
        (state.sendError ? '<p class="err form-err">' + esc(state.sendError) + '</p>' : '') +
        '<div class="actions"><button class="btn primary" data-act="confirm"' + (state.busy ? ' disabled' : '') + '>Confirm & Send</button>' +
        '<button class="btn ghost-dark" data-act="back">Edit</button></div></section>';
    }

    var qr = state.sendMode === 'qr';
    var recents = S.recentRecipients(user.id).map(function (p) {
      return '<button type="button" class="chip" data-act="fill" data-id="' + esc(p.walletId) + '">' + esc(p.name) + ' · ' + esc(p.walletId) + '</button>';
    }).join('');

    var allowanceInfo = '';
    if (qr && state.safetyData && state.safetyData.allowance) {
      var al = state.safetyData.allowance;
      allowanceInfo = '<div class="alert-banner ' + (al.isNearLimit ? 'warn' : 'info') + '">' +
        '<span>Offline Spending Allowance: <b>' + fmt(al.remaining) + ' / ' + fmt(al.limit) + ' coins available</b>. ' +
        (al.isNearLimit ? 'Warning: You are approaching your offline spending limit.' : '') + '</span></div>';
    }

    return '<section class="block narrow"><h1>' + (qr ? 'Pay Offline by QR' : 'Send Virtual Coins') + '</h1>' +
      modeSwitch() +
      allowanceInfo +
      '<p class="sub">Available to spend: <b>' + fmt(avail) + '</b> coins.' +
        (qr ? ' Generates a cryptographically signed digital payment token readable without internet.' : '') + '</p>' +
      '<form id="sendForm" novalidate>' +
      field('to', 'Recipient Wallet ID', 'type="text" placeholder="CP-1234" value="' + esc(d.to) + '" autocomplete="off" autocapitalize="characters" spellcheck="false"',
        (recents && !qr ? '<div class="chips">' + recents + '</div>' : '') +
        '<p class="hint"><button type="button" class="linkbtn dark" data-act="go" data-view="scan">Scan receiver QR code</button></p>') +
      field('amount', 'Amount (coins)', 'type="number" min="1" step="1" value="' + esc(d.amount) + '" autocomplete="off"') +
      (qr ? '' : field('note', 'Note (optional)', 'type="text" maxlength="60" value="' + esc(d.note) + '" autocomplete="off"')) +
      (state.sendError ? '<p class="err form-err">' + esc(state.sendError) + '</p>' : '') +
      '<button class="btn primary" type="submit"' + (state.busy ? ' disabled' : '') + '>' + (qr ? 'Generate Signed QR Code' : 'Review Transfer') + '</button>' +
      '</form></section>';
  }

  function scanView(user) {
    var res = state.scanResult;
    if (res) {
      if (res.ok) {
        var t = res.tx || {};
        return '<section class="block narrow"><h1>Offline Payment Stored</h1>' +
          '<div class="alert-banner good"><span>Cryptographic signature validated successfully!</span></div>' +
          '<p class="done-line"><b>' + fmt(t.amount || 0) + ' coins</b> from <span class="mono">' + esc(t.sender || '') + '</span> saved locally in IndexedDB.</p>' +
          '<dl class="facts"><dt>Transaction ID</dt><dd class="mono">' + esc(t.tx_id || '') + '</dd>' +
          '<dt>Status</dt><dd><span class="status pending">Pending Sync</span></dd></dl>' +
          '<p class="fine">Payment will be settled and credited on the server automatically once connected.</p>' +
          '<div class="actions"><button class="btn primary" data-act="go" data-view="wallet">Back to wallet</button>' +
          '<button class="btn ghost-dark" data-act="scanagain">Scan another code</button></div></section>';
      }
      return '<section class="block narrow"><h1>Payment Code Rejected</h1>' +
        '<div class="alert-banner warn"><span>' + esc(res.reason || 'Invalid or duplicate payment.') + '</span></div>' +
        '<div class="actions"><button class="btn primary" data-act="scanagain">Scan again</button>' +
        '<button class="btn ghost-dark" data-act="go" data-view="wallet">Back to wallet</button></div></section>';
    }
    return '<section class="block narrow"><h1>Scan a Code</h1>' +
      '<p class="sub">Scan a signed payment QR code to receive coins offline, or scan someone’s wallet ID to pay them.</p>' +
      '<div class="viewfinder"><video id="scanVideo" muted playsinline></video></div>' +
      '<p class="hint" id="scanNote">Initializing camera viewfinder…</p>' +
      '<details class="codetext" open><summary>Or paste payment payload text manually</summary>' +
      '<textarea id="pasteCode" rows="3" placeholder="Paste COINPATH:v1:... or wallet ID"></textarea>' +
      '<button class="btn ghost-dark small" data-act="usepaste">Process pasted payload</button></details>' +
      '</section>';
  }

  function qrHistory(user) {
    var rows = localFor(user);
    var label = { pending: 'Pending Sync', done: 'Confirmed', duplicate: 'Duplicate (Safe)', rejected: 'Rejected' };
    var canSync = !!config.apiBase;
    var list = rows.length ? '<ul class="txs">' + rows.map(function (x) {
      var out = x.tx.sender === user.walletId;
      var other = out ? x.tx.receiver : x.tx.sender;
      var p = S.lookup(other);
      return '<li><div class="row static">' +
        '<span class="r-main"><b>' + (out ? 'To ' : 'From ') + esc(p ? p.name : other) + '</b>' +
        '<small>' + esc(when(x.tx.timestamp || Date.now())) + ' · ID: ' + esc(x.tx.tx_id) +
        (x.reason ? ' · ' + esc(x.reason) : '') + '</small></span>' +
        '<span class="right"><span class="amt ' + (out ? 'out' : 'in') + '">' + (out ? '−' : '+') + fmt(x.tx.amount) + '</span>' +
        '<span class="status ' + (x.kind || 'pending') + '">' + (label[x.kind] || 'Pending') + '</span></span></div></li>';
    }).join('') + '</ul>' : '<p class="empty">No offline QR transactions recorded on this device.</p>';

    return '<section class="block"><div class="block-head"><h2>Offline Storage Ledger (IndexedDB)</h2>' +
      '<button class="btn ghost-dark small" data-act="sync"' + (canSync ? '' : ' disabled') + '>Sync with Server Now</button></div>' +
      list +
      '</section>';
  }

  function historyView(user) {
    var rows = S.history(user.id).filter(function (r) {
      return state.filter === 'all' || r.dir === state.filter;
    });
    function f(key, label) {
      return '<button data-act="filter" data-f="' + key + '" class="' + (state.filter === key ? 'on' : '') + '">' + label + '</button>';
    }
    return '<section class="block"><div class="block-head"><h1>Transaction History</h1>' +
      '<div class="seg small">' + f('all', 'All') + f('out', 'Sent') + f('in', 'Received') + '</div></div>' +
      txList(rows) + '</section>' + qrHistory(user);
  }

  // ---------- Safety Dashboard View ----------
  function safetyView(user) {
    var data = state.safetyData || {
      allowance: { limit: 200, used: 0, remaining: 200, percentUsed: 0 },
      metrics: { pending: 0, confirmed: 0, rejected: 0, duplicates: 0, total: 0 },
      lastSync: null,
      isOnline: navigator.onLine !== false,
      auditEvents: []
    };
    var al = data.allowance;
    var m = data.metrics;
    var isOnline = navigator.onLine !== false;

    return '<section class="block"><h1>Safety Dashboard</h1>' +
      '<p class="sub">Real-time cryptographic audit trail, offline spending allowance controls, and duplicate payment neutralization.</p>' +

      '<div class="safety-grid">' +
        '<div class="stat-card"><span class="label">Wallet Balance</span><span class="num">' + fmt(S.balance(user.id)) + '</span><small>Virtual coins</small></div>' +
        '<div class="stat-card"><span class="label">Pending Sync</span><span class="num warn">' + m.pending + '</span><small>Awaiting backend validation</small></div>' +
        '<div class="stat-card"><span class="label">Confirmed Transactions</span><span class="num good">' + m.confirmed + '</span><small>Authoritative server debits</small></div>' +
        '<div class="stat-card"><span class="label">Duplicates Neutralized</span><span class="num">' + m.duplicates + '</span><small>Prevented double debit</small></div>' +
        '<div class="stat-card"><span class="label">Rejected Invalid</span><span class="num bad">' + m.rejected + '</span><small>Limits or bad signature</small></div>' +
        '<div class="stat-card"><span class="label">Connection Mode</span><span class="num" style="font-size:1.3rem;">' + (isOnline ? 'Online' : 'Offline') + '</span><small>' + (isOnline ? 'Direct server sync active' : 'Local IndexedDB isolation') + '</small></div>' +
      '</div>' +

      '<div class="limit-box">' +
        '<div class="block-head"><h2>Offline Spending Limit</h2>' +
        '<span class="mono">' + fmt(al.used) + ' / ' + fmt(al.limit) + ' coins used</span></div>' +
        '<div class="progress-bar">' +
          '<div class="progress-fill ' + (al.percentUsed > 80 ? 'danger' : (al.percentUsed > 60 ? 'warn' : '')) + '" style="width:' + al.percentUsed + '%;"></div>' +
        '</div>' +
        '<p class="fine">Remaining offline allowance: <b>' + fmt(al.remaining) + ' coins</b>. New offline transactions will be blocked if they exceed this limit.</p>' +
        '<form id="limitForm" class="actions" style="margin-top:12px;" novalidate>' +
          '<input type="number" id="newLimit" name="newLimit" min="10" max="5000" value="' + al.limit + '" style="width:140px; padding:6px 10px;" required>' +
          '<button class="btn ghost-dark small" type="submit">Update Limit</button>' +
        '</form>' +
      '</div>' +

      '<div class="block">' +
        '<div class="block-head"><h2>System Verification & Audit Trail</h2>' +
        '<button class="btn ghost-dark small" data-act="sync">Run Re-Sync</button></div>' +
        (data.auditEvents && data.auditEvents.length ?
          '<table class="audit-table"><thead><tr><th>Time</th><th>Event</th><th>Description</th></tr></thead><tbody>' +
          data.auditEvents.map(function (e) {
            return '<tr><td><small>' + esc(when(e.timestamp)) + '</small></td>' +
              '<td><span class="mono" style="font-size:0.8rem;">' + esc(e.type) + '</span></td>' +
              '<td>' + esc(e.description) + '</td></tr>';
          }).join('') +
          '</tbody></table>'
          : '<p class="empty">No security events logged yet.</p>') +
      '</div>' +

      '<div class="config-card">' +
        '<h2>Double-Spending Prevention Notice</h2>' +
        '<p class="fine" style="line-height:1.6;">' +
        'Digital signatures verify the sender\'s identity and protect the payment amount from tampering. ' +
        'However, mathematical signatures alone cannot guarantee that an offline device hasn\'t signed multiple conflicting payments to different recipients. ' +
        'CoinPath mitigates this through <b>Client-Side Spending Limits</b> on the device and <b>Idempotent Server Validation with SQLite Transactions</b> during reconnection. ' +
        'A duplicated transaction ID is detected via unique constraints and never debits a wallet twice.' +
        '</p>' +
      '</div></section>';
  }

  // ---------- Notifications View ----------
  function notificationsView(user) {
    var notis = state.notifications;
    return '<section class="block"><h1>Notifications & SMS Alerts</h1>' +
      '<p class="sub">Transaction confirmation alerts and SMS dispatch logs.</p>' +

      '<div class="config-card" style="margin-bottom:20px;">' +
        '<h2>SMS Notification Settings</h2>' +
        '<p class="fine">SMS alerts are dispatched exclusively by the backend once a transaction is verified and confirmed. Offline pending payments never trigger premature SMS messages.</p>' +
        '<form id="smsConfigForm" class="actions" style="margin-top:10px; align-items:center;" novalidate>' +
          '<label class="check" style="margin:0;"><input type="checkbox" id="smsEnabledToggle"' + (state.smsEnabled ? ' checked' : '') + '> Enable Transaction SMS</label>' +
          '<input type="text" id="smsPhone" value="' + esc(state.smsPhoneDraft) + '" placeholder="+1 555-0199" style="width:160px; padding:6px 10px;">' +
          '<button class="btn ghost-dark small" type="submit">Save Settings</button>' +
        '</form>' +
      '</div>' +

      '<div class="block-head"><h2>Notification Inbox</h2>' +
      (notis.length ? '<button class="linkbtn dark" data-act="markallread">Mark all as read</button>' : '') + '</div>' +
      (notis.length ?
        '<ul class="noti-list">' +
        notis.map(function (n) {
          return '<li class="noti-item ' + (n.read ? '' : 'unread') + '">' +
            '<div class="noti-head"><b>' + esc(n.title) + '</b><small>' + esc(when(n.timestamp)) + '</small></div>' +
            '<div class="noti-body">' + esc(n.message) + '</div>' +
            '<span class="noti-tag">' + (n.metadata && n.metadata.tx_id ? 'Ref: ' + esc(n.metadata.tx_id) : 'System') + '</span>' +
          '</li>';
        }).join('') +
        '</ul>'
        : '<p class="empty">No alerts in your inbox.</p>') +
      '</section>';
  }

  function render() {
    var user = S.currentUser();
    if (!user) {
      stopScanner();
      app.innerHTML = authView();
      return;
    }
    if (state.welcome) {
      stopScanner();
      app.innerHTML = welcomeView(user);
      return;
    }
    var body = state.view === 'send' ? sendView(user)
      : state.view === 'scan' ? scanView(user)
      : state.view === 'history' ? historyView(user)
      : state.view === 'safety' ? safetyView(user)
      : state.view === 'notifications' ? notificationsView(user)
      : walletView(user);
    app.innerHTML = shell(user, body);
    if (state.view === 'scan' && !state.scanResult) startScanner(); else stopScanner();
  }

  // ---------- transaction dialog ----------
  function openTx(ref) {
    var user = S.currentUser();
    if (!user) return;
    var r = S.history(user.id).filter(function (x) { return x.ref === ref; })[0];
    if (!r) {
      // Check local transactions
      var local = state.localTxs.filter(function (x) {
        var t = x.tx || x;
        return t.tx_id === ref;
      })[0];
      if (local) {
        var t = local.tx || local;
        r = {
          ref: t.tx_id,
          dir: t.receiver === user.walletId ? 'in' : 'out',
          amount: t.amount,
          ts: t.timestamp,
          otherName: t.receiver === user.walletId ? t.sender : t.receiver,
          otherWallet: t.receiver === user.walletId ? t.sender : t.receiver,
          note: (local.status === 'pending' ? 'Pending Offline Sync' : 'Settled on Server')
        };
      }
    }
    if (!r) return;

    dialog.innerHTML =
      '<h3>' + esc(rowTitle(r)) + '</h3>' +
      '<p class="dlg-amt ' + r.dir + '">' + (r.dir === 'in' ? '+' : '−') + fmt(r.amount) + ' coins</p>' +
      '<dl class="facts">' +
      '<dt>Status</dt><dd>Completed & Verified</dd>' +
      '<dt>Timestamp</dt><dd>' + esc(when(r.ts)) + '</dd>' +
      (r.kind === 'bonus' ? '' : '<dt>' + (r.dir === 'in' ? 'Sender' : 'Receiver') + '</dt><dd>' + esc(r.otherName) + ' <span class="mono">' + esc(r.otherWallet) + '</span></dd>') +
      (r.note ? '<dt>Note</dt><dd>' + esc(r.note) + '</dd>' : '') +
      '<dt>Reference ID</dt><dd class="mono">' + esc(r.ref) + '</dd></dl>' +
      '<p class="fine">Transactions are idempotently recorded with cryptographic verification and SQLite uniqueness constraints.</p>' +
      '<button class="btn primary" data-act="closeTx">Close</button>';
    if (dialog.showModal) { if (!dialog.open) dialog.showModal(); } else { dialog.setAttribute('open', ''); }
  }

  function closeTx() {
    if (dialog.close) dialog.close(); else dialog.removeAttribute('open');
  }

  // ---------- events ----------
  function resetSend() {
    state.step = 'form'; state.draft = null; state.result = null; state.sendError = ''; state.busy = false;
    state.qrResult = null;
  }

  document.addEventListener('click', function (e) {
    if (e.target === dialog) { closeTx(); return; }
    var el = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!el) return;
    var act = el.getAttribute('data-act');

    if (act === 'authtab') { state.auth = el.getAttribute('data-tab'); render(); }
    else if (act === 'go') {
      var target = el.getAttribute('data-view');
      if (target === 'send') { resetSend(); state.sendMode = 'now'; }
      state.view = target;
      state.scanResult = null;
      var user = S.currentUser();
      loadSafetyAndNotifications(user).then(render);
    }
    else if (act === 'logout') { S.logOut(); state.view = 'wallet'; state.auth = 'login'; state.scanResult = null; resetSend(); render(); }
    else if (act === 'copy') { copyText(el.getAttribute('data-text')); }
    else if (act === 'filter') { state.filter = el.getAttribute('data-f'); render(); }
    else if (act === 'tx') { openTx(el.getAttribute('data-ref')); }
    else if (act === 'closeTx') { closeTx(); }
    else if (act === 'enter') { state.welcome = false; state.view = 'wallet'; render(); }
    else if (act === 'fill') {
      var to = document.getElementById('to');
      if (to) { to.value = el.getAttribute('data-id'); document.getElementById('amount').focus(); }
    }
    else if (act === 'back') { state.step = 'form'; state.sendError = ''; render(); }
    else if (act === 'again') { resetSend(); render(); }
    else if (act === 'mode') {
      state.sendMode = el.getAttribute('data-m');
      var keepTo = document.getElementById('to');
      state.draft = keepTo ? { to: keepTo.value, amount: (document.getElementById('amount') || {}).value || '', note: '' } : null;
      state.sendError = '';
      render();
    }
    else if (act === 'scanagain') { state.scanResult = null; render(); }
    else if (act === 'usepaste') { handleScanned((document.getElementById('pasteCode') || {}).value); }
    else if (act === 'sync') { syncNow(); }
    else if (act === 'confirm') { confirmSend(); }
    else if (act === 'markallread') {
      state.notifications.forEach(function (n) { if (offline && offline.markNotificationRead) offline.markNotificationRead(n.id); });
      state.notifications.forEach(function (n) { n.read = true; });
      render();
      toast('All notifications marked as read');
    }
  });

  function confirmSend() {
    if (state.busy || !state.draft) return;
    var user = S.currentUser();
    if (!user) { render(); return; }
    state.busy = true;
    var res = S.transfer(user.id, state.draft.to, state.draft.amount, state.draft.note);
    state.busy = false;
    if (!res.ok) { state.sendError = res.error; render(); return; }
    state.result = res.tx;
    state.step = 'done';
    state.sendError = '';
    loadSafetyAndNotifications(user).then(render);
  }

  document.addEventListener('submit', function (e) {
    e.preventDefault();
    var form = e.target;

    if (form.id === 'loginForm') {
      var res = S.logIn(form.elements.username.value, form.elements.password.value);
      if (!res.ok) { showErrors(form, res.errors); return; }
      state.view = 'wallet'; resetSend(); render(); afterLogin();
    }

    else if (form.id === 'signupForm') {
      var pw = form.elements.password.value;
      if (pw !== form.elements.confirm.value) {
        showErrors(form, { confirm: 'Passwords do not match.' });
        return;
      }
      var out = S.signUp({
        name: form.elements.name.value,
        username: form.elements.username.value,
        password: pw
      });
      if (!out.ok) { showErrors(form, out.errors); return; }
      state.welcome = true; state.view = 'wallet'; resetSend(); render(); afterLogin();
    }

    else if (form.id === 'limitForm') {
      var user = S.currentUser();
      if (!user) return;
      var newLim = Number(form.elements.newLimit.value);
      if (offline && offline.setSpendingLimit) {
        offline.setSpendingLimit(user.walletId, newLim).then(function (lim) {
          toast('Offline spending limit updated to ' + lim + ' coins');
          return loadSafetyAndNotifications(user);
        }).then(render);
      }
    }

    else if (form.id === 'smsConfigForm') {
      var phone = form.elements.smsPhone.value.trim();
      var enabled = form.elements.smsEnabledToggle.checked;
      state.smsPhoneDraft = phone;
      state.smsEnabled = enabled;
      localStorage.setItem('coinpath.phone', phone);
      localStorage.setItem('coinpath.sms_enabled', String(enabled));
      toast('SMS alert settings saved');
      render();
    }

    else if (form.id === 'sendForm') {
      var user = S.currentUser();
      if (!user) { render(); return; }
      var to = form.elements.to.value.trim().toUpperCase();
      var amountText = form.elements.amount.value.trim();
      var note = form.elements.note ? form.elements.note.value.trim() : '';
      var errors = {};
      var recipient = null;
      var qrMode = state.sendMode === 'qr';
      var avail = available(user);

      if (!/^CP-\d{4,8}$/.test(to)) errors.to = 'Wallet IDs follow the format CP-1234.';
      else if (to === user.walletId) errors.to = 'You cannot send coins to your own wallet.';
      else if (!qrMode) {
        recipient = S.lookup(to);
        if (!recipient) errors.to = 'No local user registered with that wallet ID.';
      }

      var amount = Number(amountText);
      if (!/^\d+$/.test(amountText) || amount < 1) errors.amount = 'Enter a whole number of coins above 0.';
      else if (amount > avail) errors.amount = 'You only have ' + fmt(avail) + ' coins available.';

      if (Object.keys(errors).length) { showErrors(form, errors); return; }

      if (qrMode) {
        if (state.busy) return;
        state.draft = { to: to, amount: String(amount), note: '' };
        state.sendError = '';
        makePaymentCode(user, to, amount);
        return;
      }

      state.draft = { to: to, name: recipient ? recipient.name : to, amount: amount, note: note };
      state.step = 'review';
      state.sendError = '';
      render();
    }
  });

  document.addEventListener('input', function (e) {
    var t = e.target;
    if (t.id === 'password' && t.form && t.form.id === 'signupForm') {
      var pw = t.value, score = 0;
      if (pw.length >= 8) score++;
      if (pw.length >= 12) score++;
      if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
      if (/[0-9]/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++;
      var labels = ['Too short', 'Weak', 'Okay', 'Good', 'Strong'];
      var bar = document.getElementById('meterBar');
      var text = document.getElementById('meterText');
      if (bar) {
        bar.style.width = (pw ? (score + 1) * 20 : 0) + '%';
        bar.setAttribute('data-score', pw ? score : '');
      }
      if (text) text.textContent = pw ? labels[score] : 'At least 8 characters with a letter and a number.';
    }
  });

  document.addEventListener('change', function (e) {
    if (e.target.id === 'showPw') {
      var type = e.target.checked ? 'text' : 'password';
      ['password', 'confirm'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.type = type;
      });
    }
  });

  function refresh() {
    var user = S.currentUser();
    var onAuthForm = document.getElementById('loginForm') || document.getElementById('signupForm');
    if (onAuthForm && !user) return;
    if (user && state.view === 'send' && state.step === 'form' && !state.welcome) return;
    if (user && state.view === 'scan' && !state.scanResult) return;
    loadSafetyAndNotifications(user).then(render);
  }
  function softRender() { refresh(); }

  function syncNow() {
    if (!offline) { toast('Offline module not initialized'); return; }
    toast('Synchronizing with backend…');
    var user = S.currentUser();
    Promise.resolve().then(function () { return offline.syncNow(config.apiBase); })
      .then(loadLocal)
      .then(function () { return loadSafetyAndNotifications(user); })
      .then(function (res) {
        render();
        toast('Synchronization complete! All transactions settled.');
      })
      .catch(function (err) {
        toast('Sync failed. Transactions remain safely buffered offline.');
      });
  }

  window.addEventListener('online', setBadge);
  window.addEventListener('offline', setBadge);

  window.addEventListener('storage', function (e) {
    if (e.key === S.DB_KEY || e.key === S.SESSION_KEY) refresh();
  });

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') refresh();
  });

  setBadge();
  render();
  startOffline();
})();
