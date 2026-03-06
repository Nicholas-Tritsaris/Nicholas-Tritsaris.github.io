/**
 * ██████ PROJECT SILHOUETTE — AUTH MODULE ██████
 * auth.js — Login form handler + JWT session management
 *
 * Handles:
 *  - Login modal display / dismiss
 *  - Credentials POST to backend /api/auth
 *  - JWT storage in sessionStorage (cleared on tab close)
 *  - Session expiry check
 *  - Redirect to /dashboard.html on success
 *  - Logout cleanup
 */

(function () {
  'use strict';

  // ─────────────────────────────────────────────────────────────────────────────
  // CONFIGURATION
  // ─────────────────────────────────────────────────────────────────────────────
  var AUTH_ENDPOINT = 'https://YOUR_WORKER.YOUR_SUBDOMAIN.workers.dev/api/auth';
  var DASHBOARD_URL = '/dashboard.html';
  var SESSION_KEY   = '__sil_jwt';

  // ─────────────────────────────────────────────────────────────────────────────
  // SESSION HELPERS
  // ─────────────────────────────────────────────────────────────────────────────
  function saveSession(token) {
    try { sessionStorage.setItem(SESSION_KEY, token); } catch (e) {}
  }

  function getSession() {
    try { return sessionStorage.getItem(SESSION_KEY); } catch (e) { return null; }
  }

  function clearSession() {
    try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {}
  }

  function isTokenExpired(token) {
    try {
      var parts = token.split('.');
      if (parts.length !== 3) return true;
      var payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
      return payload.exp && (payload.exp * 1000) < Date.now();
    } catch (e) { return true; }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // LOGIN MODAL
  // ─────────────────────────────────────────────────────────────────────────────
  function createModal() {
    // Remove existing modal if present
    var existing = document.getElementById('sil-modal');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.id = 'sil-modal';
    overlay.style.cssText = [
      'position:fixed;inset:0;z-index:9999;',
      'background:rgba(0,15,40,0.88);',
      'display:flex;align-items:center;justify-content:center;',
      'font-family:"Comic Sans MS","Trebuchet MS",Verdana,sans-serif;'
    ].join('');

    overlay.innerHTML = [
      '<div style="',
        'max-width:380px;width:94%;',
        'border:4px outset #99ccff;',
        'background:linear-gradient(180deg,#0a2754 0%,#051a40 100%);',
        'box-shadow:0 0 28px rgba(0,200,255,0.55);',
        'padding:0;',
      '">',
        // Header
        '<div style="',
          'background:linear-gradient(180deg,#0b2f66,#0a2754);',
          'border-bottom:3px ridge #6fbaff;',
          'padding:10px 14px;',
          'display:flex;align-items:center;justify-content:space-between;',
        '">',
          '<span style="color:#aee3ff;font-weight:bold;text-shadow:0 0 6px rgba(175,231,255,.6);">',
            '&#128274; SECURE LOGIN',
          '</span>',
          '<span id="sil-modal-close" style="',
            'color:#ffff99;cursor:pointer;font-size:18px;font-weight:bold;',
            'padding:0 4px;border:1px outset #b7dcff;',
          '">&times;</span>',
        '</div>',
        // Body
        '<div style="padding:18px 16px 20px;">',
          '<p style="color:#c8e8ff;font-size:13px;margin:0 0 14px;">',
            'Authentication required. This area is classified.',
          '</p>',
          // Username
          '<label style="display:block;color:#aee3ff;font-size:12px;margin-bottom:4px;">USERNAME</label>',
          '<input id="sil-user" type="text" autocomplete="username" style="',
            'width:100%;box-sizing:border-box;',
            'background:rgba(0,0,0,0.4);',
            'border:2px groove #6fbaff;',
            'color:#e7f3ff;padding:7px 10px;',
            'font-family:inherit;font-size:14px;margin-bottom:12px;',
          '">',
          // Password
          '<label style="display:block;color:#aee3ff;font-size:12px;margin-bottom:4px;">PASSWORD</label>',
          '<input id="sil-pass" type="password" autocomplete="current-password" style="',
            'width:100%;box-sizing:border-box;',
            'background:rgba(0,0,0,0.4);',
            'border:2px groove #6fbaff;',
            'color:#e7f3ff;padding:7px 10px;',
            'font-family:inherit;font-size:14px;margin-bottom:16px;',
          '">',
          // Error message
          '<div id="sil-error" style="',
            'color:#ff7777;font-size:12px;min-height:16px;margin-bottom:10px;display:none;',
          '"></div>',
          // Submit button
          '<button id="sil-submit" style="',
            'width:100%;',
            'background:linear-gradient(180deg,#1d4f8a,#133a69);',
            'color:#e7f3ff;',
            'border:2px outset #b7dcff;',
            'padding:9px;cursor:pointer;',
            'font-family:inherit;font-size:14px;font-weight:bold;',
          '">',
            'ACCESS SYSTEM',
          '</button>',
        '</div>',
      '</div>'
    ].join('');

    document.body.appendChild(overlay);

    // Event: close modal
    document.getElementById('sil-modal-close').addEventListener('click', function () {
      overlay.remove();
    });

    // Event: close on overlay click
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) overlay.remove();
    });

    // Event: submit on Enter
    overlay.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') submitLogin();
    });

    // Event: submit button
    document.getElementById('sil-submit').addEventListener('click', submitLogin);

    // Focus username field
    setTimeout(function () {
      var u = document.getElementById('sil-user');
      if (u) u.focus();
    }, 100);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // SUBMIT LOGIN
  // ─────────────────────────────────────────────────────────────────────────────
  function showError(msg) {
    var el = document.getElementById('sil-error');
    if (el) { el.textContent = '⚠ ' + msg; el.style.display = 'block'; }
  }

  function setLoading(loading) {
    var btn = document.getElementById('sil-submit');
    if (!btn) return;
    btn.disabled = loading;
    btn.textContent = loading ? 'AUTHENTICATING...' : 'ACCESS SYSTEM';
    btn.style.opacity = loading ? '0.7' : '1';
  }

  function submitLogin() {
    var username = (document.getElementById('sil-user') || {}).value || '';
    var password = (document.getElementById('sil-pass') || {}).value || '';

    if (!username.trim()) { showError('Username required.'); return; }
    if (!password.trim()) { showError('Password required.'); return; }

    setLoading(true);

    fetch(AUTH_ENDPOINT, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ username: username.trim(), password: password }),
      mode:    'cors',
      credentials: 'omit'
    })
    .then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })
    .then(function (data) {
      if (data && data.token) {
        saveSession(data.token);
        window.location.href = DASHBOARD_URL;
      } else {
        setLoading(false);
        showError('Invalid credentials.');
      }
    })
    .catch(function (err) {
      setLoading(false);
      if (err.message && err.message.includes('401')) {
        showError('Invalid username or password.');
      } else if (err.message && err.message.includes('429')) {
        showError('Too many attempts. Please wait.');
      } else {
        showError('Connection error. Check backend URL.');
      }
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // LOGOUT (called from dashboard)
  // ─────────────────────────────────────────────────────────────────────────────
  window.silLogout = function () {
    clearSession();
    window.location.href = '/';
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // DASHBOARD AUTH GATE (called from dashboard.html on load)
  // ─────────────────────────────────────────────────────────────────────────────
  window.silRequireAuth = function () {
    var token = getSession();
    if (!token || isTokenExpired(token)) {
      clearSession();
      window.location.href = '/?authfail=1';
      return null;
    }
    return token;
  };

  window.silGetToken = function () {
    return getSession();
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // LOGIN BUTTON HANDLER (bind to login button in index.html)
  // ─────────────────────────────────────────────────────────────────────────────
  window.silOpenLogin = function () {
    // If already authenticated, go straight to dashboard
    var token = getSession();
    if (token && !isTokenExpired(token)) {
      window.location.href = DASHBOARD_URL;
      return;
    }
    createModal();
  };

  // Auto-open if redirected back with authfail param
  if (window.location.search.indexOf('authfail=1') !== -1) {
    document.addEventListener('DOMContentLoaded', function () {
      createModal();
    });
  }

})();
