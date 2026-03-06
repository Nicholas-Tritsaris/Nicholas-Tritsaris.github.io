/**
 * ██████ PROJECT SILHOUETTE — FIRESTORE NOTE SERVICE ██████
 * tracking-backend/lib/firestore.js
 *
 * Creates a new Firestore document in the `silhouette_visits` collection
 * for each visitor hit. Also supports fetching all entries for the dashboard.
 *
 * Auth method: Google Service Account JWT → OAuth2 access token (RS256)
 * Uses Firestore REST API — no Firebase Admin SDK required (Cloudflare Workers compatible).
 *
 * Required environment variables:
 *   FIREBASE_PROJECT_ID     — Firebase project ID (e.g. "my-project-12345")
 *   FIREBASE_CLIENT_EMAIL   — Service account email
 *   FIREBASE_PRIVATE_KEY    — Service account private key (PEM, with \n line breaks)
 */

'use strict';

var TOKEN_URL      = 'https://oauth2.googleapis.com/token';
var FIRESTORE_BASE = 'https://firestore.googleapis.com/v1';
var COLLECTION     = 'silhouette_visits';
var SCOPE          = 'https://www.googleapis.com/auth/datastore';

// ──────────────────────────────────────────────────────────────────
// TOKEN MANAGEMENT
// ──────────────────────────────────────────────────────────────────

// In-memory access token cache (refreshed every ~55 minutes)
var _cachedToken = null;
var _tokenExpiry = 0;

/**
 * Base64url-encode a Buffer or string.
 * @param {Buffer|string} data
 * @returns {string}
 */
function base64url(data) {
  var b64 = Buffer.from(data).toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Create a signed JWT for Google OAuth2 using the service account private key.
 * @param {Object} env - Environment variables
 * @returns {string} - Signed JWT string
 */
function createJWT(env) {
  var crypto = require('crypto');

  var now = Math.floor(Date.now() / 1000);

  var header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  var claimSet = base64url(JSON.stringify({
    iss:   env.FIREBASE_CLIENT_EMAIL,
    sub:   env.FIREBASE_CLIENT_EMAIL,
    aud:   TOKEN_URL,
    iat:   now,
    exp:   now + 3600,
    scope: SCOPE,
  }));

  var unsignedToken = header + '.' + claimSet;

  // Support both literal \n in the key string and actual newlines
  var privateKey = env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');

  var sign = crypto.createSign('RSA-SHA256');
  sign.update(unsignedToken);
  var signature = sign.sign(privateKey, 'base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

  return unsignedToken + '.' + signature;
}

/**
 * Get a valid Google OAuth2 access token for Firestore, refreshing if necessary.
 * @param {Object} env - Environment variables
 * @returns {Promise<string>} - Access token
 */
async function getAccessToken(env) {
  var now = Date.now();

  if (_cachedToken && now < _tokenExpiry - 60000) {
    return _cachedToken;
  }

  var jwt = createJWT(env);

  var res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion:  jwt,
    }).toString(),
  });

  if (!res.ok) {
    var errBody = await res.text();
    throw new Error('Firestore token fetch failed: ' + errBody);
  }

  var data = await res.json();
  _cachedToken = data.access_token;
  _tokenExpiry = now + (data.expires_in || 3600) * 1000;
  return _cachedToken;
}

// ──────────────────────────────────────────────────────────────────
// FIRESTORE VALUE FORMAT HELPERS
// ──────────────────────────────────────────────────────────────────

/**
 * Convert a plain JS value to a Firestore REST API typed value.
 * @param {*} val
 * @returns {Object} Firestore typed value wrapper
 */
function toFirestoreValue(val) {
  if (val === null || val === undefined) {
    return { nullValue: null };
  }
  if (typeof val === 'boolean') {
    return { booleanValue: val };
  }
  if (typeof val === 'number') {
    if (Number.isInteger(val)) return { integerValue: String(val) };
    return { doubleValue: val };
  }
  if (typeof val === 'string') {
    return { stringValue: val };
  }
  if (Array.isArray(val)) {
    return {
      arrayValue: {
        values: val.map(toFirestoreValue),
      },
    };
  }
  if (typeof val === 'object') {
    return {
      mapValue: {
        fields: toFirestoreFields(val),
      },
    };
  }
  return { stringValue: String(val) };
}

/**
 * Convert a plain JS object to a Firestore fields map.
 * @param {Object} obj
 * @returns {Object} Firestore fields map
 */
function toFirestoreFields(obj) {
  var fields = {};
  var keys = Object.keys(obj || {});
  for (var i = 0; i < keys.length; i++) {
    fields[keys[i]] = toFirestoreValue(obj[keys[i]]);
  }
  return fields;
}

/**
 * Extract a plain JS value from a Firestore REST API typed value.
 * @param {Object} fval - Firestore typed value wrapper
 * @returns {*}
 */
function fromFirestoreValue(fval) {
  if (!fval) return null;
  if ('nullValue'    in fval) return null;
  if ('booleanValue' in fval) return fval.booleanValue;
  if ('integerValue' in fval) return Number(fval.integerValue);
  if ('doubleValue'  in fval) return fval.doubleValue;
  if ('stringValue'  in fval) return fval.stringValue;
  if ('arrayValue'   in fval) {
    var values = (fval.arrayValue && fval.arrayValue.values) || [];
    return values.map(fromFirestoreValue);
  }
  if ('mapValue' in fval) {
    return fromFirestoreFields((fval.mapValue && fval.mapValue.fields) || {});
  }
  return null;
}

/**
 * Convert a Firestore fields map to a plain JS object.
 * @param {Object} fields - Firestore fields map
 * @returns {Object}
 */
function fromFirestoreFields(fields) {
  var obj = {};
  var keys = Object.keys(fields || {});
  for (var i = 0; i < keys.length; i++) {
    obj[keys[i]] = fromFirestoreValue(fields[keys[i]]);
  }
  return obj;
}

// ──────────────────────────────────────────────────────────────────
// CREATE ENTRY (for /api/track)
// ──────────────────────────────────────────────────────────────────

/**
 * Create a new document in the `silhouette_visits` Firestore collection.
 * @param {Object} env       - Environment variables
 * @param {Object} payload   - Tracking JSON payload
 * @param {string} clientIP  - Resolved visitor IP
 * @param {string} formatted - Pre-formatted text block
 * @returns {Promise<{ok: boolean, id: string}>}
 */
async function createEntry(env, payload, clientIP, formatted) {
  var token     = await getAccessToken(env);
  var projectId = env.FIREBASE_PROJECT_ID;
  var timestamp = (payload && payload.timestamp) || new Date().toISOString();
  var fp        = (payload && payload.fingerprint) || 'unknown';
  var browser   = (payload && payload.browser)     || 'unknown';
  var os        = (payload && payload.os)          || 'unknown';
  var ip        = clientIP || (payload && payload.ip) || 'unknown';

  var title = '[VISIT] ' + timestamp.slice(0, 16).replace('T', ' ') +
              ' | ' + ip + ' | ' + browser + ' | ' + os +
              ' | FP: ' + fp.slice(0, 8);

  var notes = formatted
    ? formatted.slice(0, 8000)
    : JSON.stringify(payload, null, 2).slice(0, 8000);

  var doc = {
    fields: toFirestoreFields({
      title:     title,
      notes:     notes,
      payload:   payload || {},
      clientIP:  ip,
      createdAt: timestamp,
    }),
  };

  var url = FIRESTORE_BASE + '/projects/' + encodeURIComponent(projectId) +
            '/databases/(default)/documents/' + COLLECTION;

  var res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify(doc),
  });

  if (!res.ok) {
    var errText = await res.text();
    throw new Error('Firestore createEntry failed [' + res.status + ']: ' + errText);
  }

  var created = await res.json();
  // Document name format: projects/{project}/databases/(default)/documents/{collection}/{id}
  var id = created.name ? created.name.split('/').pop() : null;
  return { ok: true, id: id };
}

// ──────────────────────────────────────────────────────────────────
// LIST ENTRIES (for /api/data — dashboard)
// ──────────────────────────────────────────────────────────────────

/**
 * Fetch documents from the `silhouette_visits` collection, ordered by createdAt descending.
 * @param {Object} env   - Environment variables
 * @param {number} [max] - Max documents to fetch (default 500)
 * @returns {Promise<Object[]>} - Array of raw Firestore document objects
 */
async function listEntries(env, max) {
  var token     = await getAccessToken(env);
  var projectId = env.FIREBASE_PROJECT_ID;
  var pageSize  = max || 500;

  var qs = new URLSearchParams({
    orderBy:  'createdAt desc',
    pageSize: String(pageSize),
  });

  var url = FIRESTORE_BASE + '/projects/' + encodeURIComponent(projectId) +
            '/databases/(default)/documents/' + COLLECTION + '?' + qs.toString();

  var res = await fetch(url, {
    headers: { 'Authorization': 'Bearer ' + token },
  });

  if (!res.ok) {
    var errText = await res.text();
    throw new Error('Firestore listEntries failed [' + res.status + ']: ' + errText);
  }

  var data = await res.json();
  // Response is { documents: [...] } or {} if empty
  return data.documents || [];
}

// ──────────────────────────────────────────────────────────────────
// PARSE ENTRIES (normalize for dashboard)
// ──────────────────────────────────────────────────────────────────

/**
 * Parse raw Firestore document objects into the unified entry format used by the dashboard.
 * @param {Object[]} items - Raw Firestore document objects from listEntries
 * @returns {Object[]}     - Normalized entry array
 */
function parseEntries(items) {
  return (items || []).map(function (doc) {
    var fields = doc.fields || {};
    var docId  = doc.name ? doc.name.split('/').pop() : null;
    var title  = fields.title ? fromFirestoreValue(fields.title) : '';
    var notes  = fields.notes ? fromFirestoreValue(fields.notes) : '';

    // Try to extract from the stored payload map first
    var entry = {};
    try {
      var stored = fields.payload ? fromFirestoreValue(fields.payload) : null;
      if (stored && typeof stored === 'object') {
        entry = stored;
      }
    } catch (e) {}

    // Fallback: parse from title string
    if (!entry.timestamp) {
      var titleMatch = (title || '').match(/\[VISIT\] (\S+ \S+) \| (\S+) \| (.+?) \| (.+?) \| FP: (\w+)/);
      if (titleMatch) {
        entry.timestamp   = titleMatch[1].replace(' ', 'T') + ':00.000Z';
        entry.ip          = titleMatch[2];
        entry.browser     = titleMatch[3];
        entry.os          = titleMatch[4];
        entry.fingerprint = titleMatch[5];
      }
    }

    // Fill createdAt from Firestore field if missing
    if (!entry.timestamp && fields.createdAt) {
      entry.timestamp = fromFirestoreValue(fields.createdAt);
    }

    // Fill IP from Firestore field if missing
    if (!entry.ip && fields.clientIP) {
      entry.ip = fromFirestoreValue(fields.clientIP);
    }

    entry._docId      = docId;
    entry._docTitle   = title;
    entry._raw_notes  = notes ? notes.slice(0, 200) : '';

    return entry;
  });
}

module.exports = { createEntry, listEntries, parseEntries, getAccessToken };
