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
  var AUTH0_AUDIENCE  = ''; // Optional: Only set if you have a backend API
  var DASHBOARD_URL   = window.location.origin + '/dashboard.html';
  var REDIRECT_URI    = window.location.origin + window.location.pathname;

  var auth0Client = null;

  // Helper to get the correct creation function from CDN global
  function getCreateAuth0Client() {
    if (typeof createAuth0Client !== 'undefined') return createAuth0Client;
    if (typeof auth0 !== 'undefined' && typeof auth0.createAuth0Client !== 'undefined') return auth0.createAuth0Client;
    return null;
  }

  async function initAuth0() {
    if (auth0Client) return;

    try {
      let createFn = getCreateAuth0Client();
      if (!createFn) {
        console.warn("Auth0 SDK not loaded yet, waiting...");
        for (let i = 0; i < 50; i++) {
          await new Promise(resolve => setTimeout(resolve, 100));
          createFn = getCreateAuth0Client();
          if (createFn) break;
        }
      }

      if (!createFn) {
        throw new Error("Auth0 SDK failed to load. Please check your internet connection and Content Security Policy.");
      }

      const auth0Options = {
        domain: AUTH0_DOMAIN,
        client_id: AUTH0_CLIENT_ID,
        authorizationParams: {
          redirect_uri: REDIRECT_URI
        }
      };

      if (AUTH0_AUDIENCE) {
        auth0Options.authorizationParams.audience = AUTH0_AUDIENCE;
      }

      auth0Client = await createFn(auth0Options);

      if (window.location.search.includes("code=") && window.location.search.includes("state=")) {
        await auth0Client.handleRedirectCallback();
        window.history.replaceState({}, document.title, window.location.pathname);
      }

      const isAuthenticated = await auth0Client.isAuthenticated();
      if (isAuthenticated) {
        const loginBtn = document.getElementById('login-btn');
        if (loginBtn) {
          loginBtn.innerHTML = '&#128275; DASHBOARD';
          loginBtn.onclick = function() { window.location.href = '/dashboard.html'; return false; };
        }
      }
    } catch (err) {
      console.error("Auth0 initialization failed:", err);
    }
  }

  window.silOpenLogin = async function () {
    await initAuth0();

    if (!auth0Client) {
      alert("Authentication system is not ready. Please refresh the page.");
      return;
    }

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
    await initAuth0();
    if (auth0Client) {
      await auth0Client.logout({
        logoutParams: {
          returnTo: window.location.origin + '/'
        }
      });
    }
  };

  window.silRequireAuth = async function () {
    await initAuth0();

    if (!auth0Client) {
      console.error("Auth0 client not initialized");
      return null;
    }

    const isAuthenticated = await auth0Client.isAuthenticated();
    if (!isAuthenticated) {
      await auth0Client.loginWithRedirect({
        authorizationParams: {
          redirect_uri: REDIRECT_URI
        }
      });
      return null;
    }

    try {
      return await auth0Client.getTokenSilently();
    } catch (e) {
      console.error("Error getting token", e);
      return null;
    }
  };

  window.silGetToken = async function () {
    await initAuth0();
    if (!auth0Client) return null;
    try {
      return await auth0Client.getTokenSilently();
    } catch (e) {
      return null;
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAuth0);
  } else {
    initAuth0();
  }

})();
