/**
 * ██████ PROJECT SILHOUETTE — ONENOTE (MICROSOFT GRAPH) CLIENT ██████
 * lib/onenote.js
 *
 * Creates a new OneNote page in a designated section for each visitor hit.
 * Also supports fetching pages for the dashboard.
 *
 * Auth method: OAuth 2.0 via Microsoft Identity Platform (MSAL)
 * Rate limits: ~70 requests/minute per user (free with Microsoft account)
 *
 * Required environment variables:
 *   MS_CLIENT_ID       — Azure App Registration Application (client) ID
 *   MS_CLIENT_SECRET   — Azure App Registration client secret
 *   MS_REFRESH_TOKEN   — OAuth 2.0 offline_access refresh token
 *   MS_SECTION_ID      — Target OneNote section ID
 *   MS_TENANT_ID       — Azure tenant ID (use "consumers" for personal accounts)
 */

'use strict';

var MS_TOKEN_URL  = 'https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token';
var GRAPH_BASE    = 'https://graph.microsoft.com/v1.0/me/onenote';

// ──────────────────────────────────────────────────────────────────
// TOKEN MANAGEMENT
// ──────────────────────────────────────────────────────────────────

var _msToken   = null;
var _msExpiry  = 0;

/**
 * Get a valid Microsoft Graph access token, refreshing if necessary.
 * @param {Object} env - Environment variables
 * @returns {Promise<string>} - Access token
 */
async function getMSToken(env) {
  var now = Date.now();
  if (_msToken && now < _msExpiry - 60000) return _msToken;

  var tenant  = env.MS_TENANT_ID || 'consumers';
  var url     = MS_TOKEN_URL.replace('{tenant}', tenant);

  var res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     env.MS_CLIENT_ID,
      client_secret: env.MS_CLIENT_SECRET,
      refresh_token: env.MS_REFRESH_TOKEN,
      grant_type:    'refresh_token',
      scope:         'https://graph.microsoft.com/Notes.ReadWrite https://graph.microsoft.com/Notes.Create offline_access',
    }).toString(),
  });

  if (!res.ok) {
    var errBody = await res.text();
    throw new Error('Microsoft token refresh failed: ' + errBody);
  }

  var data    = await res.json();
  _msToken    = data.access_token;
  _msExpiry   = now + (data.expires_in || 3600) * 1000;

  // Also update refresh token if rotated
  if (data.refresh_token) {
    // In production, persist this new refresh token to persistent storage
    // For now, we update the in-memory env object if mutable
    if (typeof env === 'object') env.MS_REFRESH_TOKEN = data.refresh_token;
  }

  return _msToken;
}

// ──────────────────────────────────────────────────────────────────
// CREATE PAGE (for /api/track)
// ──────────────────────────────────────────────────────────────────

/**
 * Create a new OneNote page for a visitor hit.
 * @param {Object} env          - Environment variables
 * @param {Object} payload      - Tracking JSON payload
 * @param {string} clientIP     - Resolved visitor IP
 * @param {string} formattedHTML - Pre-formatted HTML block
 * @returns {Promise<Object>}
 */
async function createPage(env, payload, clientIP, formattedHTML) {
  var token     = await getMSToken(env);
  var sectionId = env.MS_SECTION_ID;
  if (!sectionId) throw new Error('MS_SECTION_ID not set');

  var timestamp = (payload && payload.timestamp) || new Date().toISOString();
  var ip        = clientIP || (payload && payload.ip)         || 'unknown';
  var browser   = (payload && payload.browser)                || 'unknown';
  var os        = (payload && payload.os)                     || 'unknown';
  var fp        = (payload && payload.fingerprint)            || 'unknown';
  var title     = '[VISIT] ' + timestamp.slice(0, 19).replace('T', ' ') + ' | ' + ip + ' | ' + browser + ' | ' + os;

  // OneNote pages are submitted as multipart/form-data with the HTML content
  var htmlContent = formattedHTML || buildFallbackHTML(payload, clientIP);

  var pageHTML = [
    '<!DOCTYPE html>',
    '<html>',
    '<head>',
    '  <title>' + escapeHTML(title) + '</title>',
    '  <meta name="created" content="' + timestamp + '" />',
    '</head>',
    '<body>',
    '  <h1 style="font-family:monospace;color:#003366;">' + escapeHTML(title) + '</h1>',
    '  <p style="font-style:italic;color:#666;">Fingerprint: <code>' + escapeHTML(fp) + '</code></p>',
    '  ' + (htmlContent || ''),
    '</body>',
    '</html>',
  ].join('\n');

  var url = GRAPH_BASE + '/sections/' + encodeURIComponent(sectionId) + '/pages';
  var res = await fetch(url, {
    method:  'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type':  'application/xhtml+xml',
    },
    body: pageHTML,
  });

  if (!res.ok) {
    var errText = await res.text();
    throw new Error('OneNote page create failed [' + res.status + ']: ' + errText);
  }

  return res.json();
}

// ──────────────────────────────────────────────────────────────────
// LIST PAGES (for /api/data — dashboard)
// ──────────────────────────────────────────────────────────────────

/**
 * Fetch all pages from the designated OneNote section.
 * @param {Object} env     - Environment variables
 * @param {number} [max]   - Max pages (default 500)
 * @returns {Promise<Object[]>}
 */
async function listPages(env, max) {
  var token     = await getMSToken(env);
  var sectionId = env.MS_SECTION_ID;
  if (!sectionId) throw new Error('MS_SECTION_ID not set');

  var pages = [];
  var top   = Math.min(max || 500, 100); // MS Graph max per page
  var url   = GRAPH_BASE + '/sections/' + encodeURIComponent(sectionId) +
              '/pages?$top=' + top + '&$select=id,title,createdDateTime,lastModifiedDateTime&$orderby=createdDateTime desc';

  while (url) {
    var res = await fetch(url, {
      headers: { 'Authorization': 'Bearer ' + token },
    });

    if (!res.ok) {
      var errText = await res.text();
      throw new Error('OneNote list pages failed [' + res.status + ']: ' + errText);
    }

    var data = await res.json();
    if (data.value) pages = pages.concat(data.value);
    url = data['@odata.nextLink'] || null;
    if (max && pages.length >= max) break;
  }

  return pages;
}

/**
 * Fetch the full content HTML of a single page.
 * @param {Object} env    - Environment variables
 * @param {string} pageId - OneNote page ID
 * @returns {Promise<string>} - Page HTML content
 */
async function getPageContent(env, pageId) {
  var token = await getMSToken(env);
  var url   = GRAPH_BASE + '/pages/' + encodeURIComponent(pageId) + '/content';
  var res   = await fetch(url, {
    headers: { 'Authorization': 'Bearer ' + token },
  });
  if (!res.ok) throw new Error('OneNote get page content failed [' + res.status + ']');
  return res.text();
}

/**
 * Parse OneNote page metadata into the unified entry format (lightweight).
 * Note: Full payload data requires fetching each page's content separately.
 * @param {Object[]} pages
 * @returns {Object[]}
 */
function parsePages(pages) {
  return (pages || []).map(function (page) {
    var entry = { _pageId: page.id, _pageTitle: page.title };

    // Try to extract data from title: [VISIT] 2026-03-06 12:47:00 | 1.2.3.4 | Chrome 130 | Windows 11
    var m = (page.title || '').match(/\[VISIT\] (\S+ \S+) \| (\S+) \| (.+?) \| (.+)/);
    if (m) {
      entry.timestamp = m[1].replace(' ', 'T') + ':00.000Z';
      entry.ip        = m[2];
      entry.browser   = m[3];
      entry.os        = m[4];
    } else {
      entry.timestamp = page.createdDateTime;
    }

    return entry;
  });
}

// ──────────────────────────────────────────────────────────────────
// HELPERS
// ──────────────────────────────────────────────────────────────────

function escapeHTML(s) {
  return String(s || '').replace(/&/g,'&').replace(/</g,'<').replace(/>/g,'>').replace(/"/g,'"');
}

function buildFallbackHTML(payload, clientIP) {
  var p = payload || {};
  var s = p.screen || {};
  var w = p.webgl  || {};
  var b = p.battery || {};
  var c = p.connection || {};

  function row(k, v) {
    return '<tr><td style="font-weight:bold;color:#336699;padding:3px 8px;">' + escapeHTML(k) + '</td><td style="font-family:monospace;padding:3px 8px;">' + escapeHTML(String(v !== null && v !== undefined ? v : '—')) + '</td></tr>';
  }

  return [
    '<table border="1" cellpadding="3" style="border-collapse:collapse;font-size:12px;">',
    row('IP',           clientIP || p.ip),
    row('Fingerprint',  p.fingerprint),
    row('Browser',      p.browser),
    row('OS',           p.os),
    row('Timezone',     p.timezone),
    row('Screen',       (s.width || '?') + '×' + (s.height || '?')),
    row('GPU',          w.renderer),
    row('Battery',      b.level !== null && b.level !== undefined ? Math.round((b.level||0)*100) + '%' : '—'),
    row('Adblock',      p.adblockDetected ? 'Yes' : 'No'),
    row('Incognito',    p.incognitoMode),
    row('Connection',   c.type),
    row('WebRTC IP',    p.webrtcIP),
    row('Referrer',     p.referrer),
    '</table>',
  ].join('');
}

module.exports = { createPage, listPages, getPageContent, parsePages, getMSToken };
