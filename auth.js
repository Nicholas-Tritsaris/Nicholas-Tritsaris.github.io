/**
 * ██████ PROJECT SILHOUETTE — AUTH MODULE (Auth0 Edition) ██████
 * auth.js — Auth0 SDK wrapper + session management
 */

(function () {
  'use strict';

  // ─────────────────────────────────────────────────────────────────────────────
  // CONFIGURATION
  // ─────────────────────────────────────────────────────────────────────────────
  var AUTH0_DOMAIN    = 'YOUR_AUTH0_DOMAIN';
  var AUTH0_CLIENT_ID = 'YOUR_AUTH0_CLIENT_ID';
  var AUTH0_AUDIENCE  = 'https://YOUR_WORKER.YOUR_SUBDOMAIN.workers.dev/api';
  var DASHBOARD_URL   = window.location.origin + '/dashboard.html';
  var REDIRECT_URI    = window.location.origin + '/';

  var auth0Client = null;

  async function initAuth0() {
    try {
      auth0Client = await createAuth0Client({
        domain: AUTH0_DOMAIN,
        client_id: AUTH0_CLIENT_ID,
        authorizationParams: {
          audience: AUTH0_AUDIENCE,
          redirect_uri: window.location.origin + '/'
        }
      });

      // Handle the redirect callback
      if (window.location.search.includes("code=") && window.location.search.includes("state=")) {
        await auth0Client.handleRedirectCallback();
        window.history.replaceState({}, document.title, "/");

        // If we were on index.html and logged in, maybe we want to go to dashboard?
        // But usually silOpenLogin is what starts it.
      }

      const isAuthenticated = await auth0Client.isAuthenticated();
      if (isAuthenticated) {
        console.log("User is authenticated");
        // Update UI if needed
        const loginBtn = document.getElementById('login-btn');
        if (loginBtn) {
          loginBtn.innerHTML = '&#128275; DASHBOARD';
          loginBtn.onclick = function() { window.location.href = '/dashboard.html'; return false; };
        }
      }
    } catch (err) {
      console.error("Auth0 initialization failed", err);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // AUTH ACTIONS
  // ─────────────────────────────────────────────────────────────────────────────

  window.silOpenLogin = async function () {
    if (!auth0Client) await initAuth0();

    const isAuthenticated = await auth0Client.isAuthenticated();
    if (isAuthenticated) {
      window.location.href = '/dashboard.html';
    } else {
      await auth0Client.loginWithRedirect({
        authorizationParams: {
          redirect_uri: window.location.origin + '/'
        }
      });
    }
  };

  window.silLogout = async function () {
    if (!auth0Client) await initAuth0();
    await auth0Client.logout({
      logoutParams: {
        returnTo: window.location.origin + '/'
      }
    });
  };

  window.silRequireAuth = async function () {
    if (!auth0Client) await initAuth0();

    const isAuthenticated = await auth0Client.isAuthenticated();
    if (!isAuthenticated) {
      // Not authenticated, redirect to login
      await auth0Client.loginWithRedirect({
        authorizationParams: {
          redirect_uri: window.location.origin + '/'
        }
      });
      return null;
    }

    try {
      const token = await auth0Client.getTokenSilently();
      return token;
    } catch (e) {
      console.error("Error getting token", e);
      return null;
    }
  };

  window.silGetToken = async function () {
    if (!auth0Client) await initAuth0();
    try {
      return await auth0Client.getTokenSilently();
    } catch (e) {
      return null;
    }
  };

  // Auto-init on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAuth0);
  } else {
    initAuth0();
  }

})();
