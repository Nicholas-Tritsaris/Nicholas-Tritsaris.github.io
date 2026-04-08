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
// AUTH0 JWT VERIFICATION (RS256)
// ──────────────────────────────────────────────────────────────────

async function verifyAuth0Token(token, env) {
  try {
    const domain = env.AUTH0_DOMAIN;
    const audience = env.AUTH0_AUDIENCE;

    if (!domain || !audience) {
      throw new Error('Auth0 domain or audience not configured');
    }

    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const header = JSON.parse(atob(parts[0].replace(/-/g, '+').replace(/_/g, '/')));
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));

    if (payload.iss !== `https://${domain}/`) return null;
    if (Array.isArray(payload.aud) ? !payload.aud.includes(audience) : payload.aud !== audience) return null;
    if (payload.exp && payload.exp * 1000 < Date.now()) return null;

    // Fetch JWKS to get public key
    const jwksRes = await fetch(`https://${domain}/.well-known/jwks.json`);
    const jwks = await jwksRes.json();
    const keyData = jwks.keys.find(k => k.kid === header.kid);
    if (!keyData) return null;

    const publicKey = await crypto.subtle.importKey(
      'jwk',
      keyData,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    );

    const encoder = new TextEncoder();
    const data = encoder.encode(parts[0] + '.' + parts[1]);
    const signature = new Uint8Array(atob(parts[2].replace(/-/g, '+').replace(/_/g, '/')).split('').map(c => c.charCodeAt(0)));

    const isValid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      publicKey,
      signature,
      data
    );

    return isValid ? payload : null;
  } catch (e) {
    console.error('JWT Verification Error:', e);
    return null;
  }
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

async function handleData(request, env, clientIP, origin) {
  // Verify JWT
  var authHeader = request.headers.get('Authorization') || '';
  var token      = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) return errResponse('unauthorized', 401, origin, env);

  var jwtPayload = await verifyAuth0Token(token, env);
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
