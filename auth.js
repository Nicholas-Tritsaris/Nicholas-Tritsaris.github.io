/**
 * ██████ PROJECT SILHOUETTE — AUTH MODULE (Auth0 Edition) ██████
 * auth.js — Auth0 SDK wrapper + session management
 */

(function () {
  'use strict';

  // ─────────────────────────────────────────────────────────────────────────────
  // CONFIGURATION
  // ─────────────────────────────────────────────────────────────────────────────
  var AUTH0_DOMAIN    = 'blueboop.au.auth0.com';
  var AUTH0_CLIENT_ID = 'yfnDQa8raUx03VkZD4Co0z7sLPSgasUo';
  var AUTH0_AUDIENCE  = 'https://silhouette-api'; // Update to match your Auth0 API Identifier
  var DASHBOARD_URL   = window.location.origin + '/dashboard.html';
  var REDIRECT_URI    = window.location.origin + window.location.pathname;

  var auth0Client = null;

  async function initAuth0() {
    try {
      auth0Client = await createAuth0Client({
        domain: AUTH0_DOMAIN,
        client_id: AUTH0_CLIENT_ID,
        authorizationParams: {
          audience: AUTH0_AUDIENCE,
          redirect_uri: REDIRECT_URI
        }
      });

      // Handle the redirect callback
      if (window.location.search.includes("code=") && window.location.search.includes("state=")) {
        await auth0Client.handleRedirectCallback();
        window.history.replaceState({}, document.title, window.location.pathname);

        // If we just logged in, and we're not on dashboard, maybe go there?
        // Actually, silOpenLogin handles the explicit redirect.
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
          redirect_uri: window.location.origin + '/dashboard.html'
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
          redirect_uri: REDIRECT_URI
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
