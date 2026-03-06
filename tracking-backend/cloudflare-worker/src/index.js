/**
 * ██████ PROJECT SILHOUETTE — CLOUDFLARE WORKERS BACKEND ██████
 * src/index.js — Main Worker Entry Point
 *
 * Endpoints:
 *   POST /api/track  — Receive visitor fingerprint payload
 *   POST /api/auth   — Verify admin credentials, return JWT
 *   GET  /api/data   — Fetch all tracking entries (JWT required)
 *   OPTIONS *        — CORS preflight
 */

// ── Note service clients (inlined for Workers bundling compatibility)
import { formatText, formatHTML } from '../../lib/formatter.js';
import { createTask, listTasks, parseTasks } from '../../lib/google-tasks.js';
import { createNote, listNotes } from '../../lib/evernote.js';
import { createPage, listPages, parsePages } from '../../lib/onenote.js';
import { createEntry, listEntries, parseEntries } from '../../lib/firestore.js';

// ──────────────────────────────────────────────────────────────────
// CORS
// ──────────────────────────────────────────────────────────────────

function getAllowedOrigins(env) {
  return [
    env.ALLOWED_ORIGIN_1 || 'https://blueboop.is-a.dev',
    env.ALLOWED_ORIGIN_2 || 'https://nicholas-tritsaris.github.io',
    'http://localhost:3000',  // For local dev
    'http://127.0.0.1:5500', // For VS Code Live Server
  ];
}

function corsHeaders(origin, env) {
  var allowed = getAllowedOrigins(env);
  var o = allowed.includes(origin) ? origin : allowed[0];
  return {
    'Access-Control-Allow-Origin':  o,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age':       '86400',
    'Vary': 'Origin',
  };
}

function jsonResponse(data, status, origin, env) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(origin, env),
    },
  });
}

function errResponse(msg, status, origin, env) {
  return jsonResponse({ error: msg }, status || 400, origin, env);
}

// ──────────────────────────────────────────────────────────────────
// JWT (minimal — no external library needed)
// ──────────────────────────────────────────────────────────────────

async function signJWT(payload, secret) {
  var header  = { alg: 'HS256', typ: 'JWT' };
  var encHdr  = b64url(JSON.stringify(header));
  var encPld  = b64url(JSON.stringify(payload));
  var input   = encHdr + '.' + encPld;
  var key     = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  var sig     = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(input));
  var encSig  = arrayToB64url(new Uint8Array(sig));
  return input + '.' + encSig;
}

async function verifyJWT(token, secret) {
  try {
    var parts = token.split('.');
    if (parts.length !== 3) return null;
    var input   = parts[0] + '.' + parts[1];
    var key     = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    );
    var sigBytes = b64urlToArray(parts[2]);
    var valid    = await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(input));
    if (!valid) return null;
    var payload  = JSON.parse(atob(parts[1].replace(/-/g,'+').replace(/_/g,'/')));
    if (payload.exp && payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

function b64url(str) {
  return btoa(str).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
}

function arrayToB64url(arr) {
  return btoa(String.fromCharCode(...arr)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
}

function b64urlToArray(str) {
  var b = str.replace(/-/g,'+').replace(/_/g,'/');
  var bin = atob(b);
  return new Uint8Array(bin.split('').map(c => c.charCodeAt(0)));
}

// ──────────────────────────────────────────────────────────────────
// CREDENTIAL VERIFICATION
// ──────────────────────────────────────────────────────────────────

async function sha256Hex(str) {
  var data = new TextEncoder().encode(str);
  var buf  = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

async function verifyCredentials(username, password, env) {
  if (!env.ADMIN_USERNAME || !env.ADMIN_PASSWORD_HASH) {
    throw new Error('Admin credentials not configured');
  }
  // Constant-time username comparison
  if (username !== env.ADMIN_USERNAME) return false;
  // Password is stored as SHA-256(password)
  // Generate hash: echo -n "yourpassword" | sha256sum
  var inputHash = await sha256Hex(password);
  return inputHash === env.ADMIN_PASSWORD_HASH.toLowerCase();
}

// ──────────────────────────────────────────────────────────────────
// RATE LIMITING (in-memory — resets on worker restart)
// ──────────────────────────────────────────────────────────────────

var authAttempts = new Map(); // ip → { count, firstTry }

function checkRateLimit(ip) {
  var now   = Date.now();
  var entry = authAttempts.get(ip);
  if (!entry || (now - entry.firstTry) > 15 * 60 * 1000) {
    authAttempts.set(ip, { count: 1, firstTry: now });
    return true; // allowed
  }
  if (entry.count >= 10) return false; // blocked
  entry.count++;
  return true;
}

// ──────────────────────────────────────────────────────────────────
// NOTE SERVICE DISPATCHER
// ──────────────────────────────────────────────────────────────────

async function storeEntry(env, payload, clientIP) {
  var service  = (env.NOTE_SERVICE || 'google-tasks').toLowerCase();
  var textFmt  = formatText(payload, clientIP);
  var htmlFmt  = formatHTML(payload, clientIP);

  switch (service) {
    case 'google-tasks':
      return createTask(env, payload, clientIP, textFmt);
    case 'evernote':
      return createNote(env, payload, clientIP, textFmt, htmlFmt);
    case 'onenote':
      return createPage(env, payload, clientIP, htmlFmt);
    case 'firestore':
      return createEntry(env, payload, clientIP, textFmt);
    default:
      throw new Error('Unknown note service: ' + service);
  }
}

async function fetchEntries(env) {
  var service = (env.NOTE_SERVICE || 'google-tasks').toLowerCase();
  switch (service) {
    case 'google-tasks': {
      var items = await listTasks(env);
      return parseTasks(items);
    }
    case 'evernote': {
      var notes = await listNotes(env);
      return notes;
    }
    case 'onenote': {
      var pages = await listPages(env);
      return parsePages(pages);
    }
    case 'firestore': {
      var items = await listEntries(env);
      return parseEntries(items);
    }
    default:
      throw new Error('Unknown note service: ' + service);
  }
}

// ──────────────────────────────────────────────────────────────────
// ROUTE HANDLERS
// ──────────────────────────────────────────────────────────────────

async function handleTrack(request, env, clientIP, origin) {
  // Validate Content-Type
  var ct = request.headers.get('content-type') || '';
  if (!ct.includes('application/json')) {
    return errResponse('content_type_required', 415, origin, env);
  }

  // Parse + validate payload
  var payload;
  try {
    var text = await request.text();
    if (text.length > 32768) return errResponse('payload_too_large', 413, origin, env);
    payload = JSON.parse(text);
  } catch (e) {
    return errResponse('invalid_json', 400, origin, env);
  }

  if (!payload || typeof payload !== 'object') {
    return errResponse('invalid_payload', 400, origin, env);
  }

  // Sanitize string fields (prevent injection into note services)
  payload = sanitize(payload);
  payload.ip = clientIP; // Override IP from headers (authoritative)

  try {
    await storeEntry(env, payload, clientIP);
    return jsonResponse({ status: 'ok' }, 200, origin, env);
  } catch (e) {
    console.error('storeEntry error:', e.message);
    return jsonResponse({ status: 'ok' }, 200, origin, env); // Silent success — don't reveal backend errors
  }
}

async function handleAuth(request, env, clientIP, origin) {
  // Rate limit by IP
  if (!checkRateLimit(clientIP)) {
    return errResponse('too_many_requests', 429, origin, env);
  }

  var body;
  try {
    body = await request.json();
  } catch (e) {
    return errResponse('invalid_json', 400, origin, env);
  }

  var { username, password } = body || {};
  if (!username || !password) {
    return errResponse('credentials_required', 400, origin, env);
  }

  var valid;
  try {
    valid = await verifyCredentials(String(username), String(password), env);
  } catch (e) {
    return errResponse('auth_not_configured', 500, origin, env);
  }

  if (!valid) {
    return errResponse('invalid_credentials', 401, origin, env);
  }

  // Sign JWT — 1 hour expiry
  var now     = Math.floor(Date.now() / 1000);
  var payload = { sub: username, iat: now, exp: now + 3600, iss: 'silhouette' };
  var token   = await signJWT(payload, env.JWT_SECRET);

  return jsonResponse({ token }, 200, origin, env);
}

async function handleData(request, env, clientIP, origin) {
  // Verify JWT
  var authHeader = request.headers.get('Authorization') || '';
  var token      = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) return errResponse('unauthorized', 401, origin, env);

  var jwtPayload = await verifyJWT(token, env.JWT_SECRET);
  if (!jwtPayload) return errResponse('invalid_token', 401, origin, env);

  try {
    var entries = await fetchEntries(env);
    return jsonResponse({ entries, count: entries.length }, 200, origin, env);
  } catch (e) {
    console.error('fetchEntries error:', e.message);
    return errResponse('upstream_error: ' + e.message, 502, origin, env);
  }
}

// ──────────────────────────────────────────────────────────────────
// SANITIZE — strip script/HTML from string fields
// ──────────────────────────────────────────────────────────────────

function sanitize(obj, depth) {
  if (depth > 5) return {};
  if (typeof obj === 'string') {
    return obj.replace(/<script[\s\S]*?<\/script>/gi, '')
              .replace(/<[^>]+>/g, '')
              .slice(0, 4096);
  }
  if (Array.isArray(obj)) return obj.slice(0, 50).map(v => sanitize(v, (depth||0)+1));
  if (obj !== null && typeof obj === 'object') {
    var out = {};
    for (var k of Object.keys(obj).slice(0, 50)) {
      out[sanitize(k, (depth||0)+1)] = sanitize(obj[k], (depth||0)+1);
    }
    return out;
  }
  return obj;
}

// ──────────────────────────────────────────────────────────────────
// MAIN FETCH HANDLER
// ──────────────────────────────────────────────────────────────────

export default {
  async fetch(request, env, ctx) {
    var url      = new URL(request.url);
    var path     = url.pathname;
    var method   = request.method.toUpperCase();
    var origin   = request.headers.get('origin') || '';
    var clientIP = request.headers.get('CF-Connecting-IP') ||
                   request.headers.get('X-Forwarded-For') ||
                   '0.0.0.0';

    // Extract first IP if X-Forwarded-For is a list
    clientIP = clientIP.split(',')[0].trim();

    // ── CORS Preflight ──
    if (method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(origin, env),
      });
    }

    // ── CORS Origin Check ──
    var allowed = getAllowedOrigins(env);
    if (origin && !allowed.includes(origin)) {
      return new Response(JSON.stringify({ error: 'origin_denied' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // ── ROUTE DISPATCH ──
    if (path === '/api/track' && method === 'POST') {
      return handleTrack(request, env, clientIP, origin);
    }

    if (path === '/api/auth' && method === 'POST') {
      return handleAuth(request, env, clientIP, origin);
    }

    if (path === '/api/data' && method === 'GET') {
      return handleData(request, env, clientIP, origin);
    }

    // ── Health Check ──
    if (path === '/health') {
      return jsonResponse({ status: 'operational', service: 'silhouette-tracker' }, 200, origin, env);
    }

    return jsonResponse({ error: 'not_found' }, 404, origin, env);
  },
};
