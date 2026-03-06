/**
 * ██████ PROJECT SILHOUETTE — NODE.JS EXPRESS SERVER ██████
 * src/server.js — Full Express application
 *
 * Run: npm start
 * Dev: npm run dev
 * PM2: npm run pm2
 */
'use strict';

require('dotenv').config();

var express       = require('express');
var helmet        = require('helmet');
var rateLimit     = require('express-rate-limit');
var crypto        = require('crypto');
var jwt           = require('jsonwebtoken');
var { formatText, formatHTML } = require('../../lib/formatter');
var { createTask, listTasks, parseTasks } = require('../../lib/google-tasks');
var { createNote, listNotes }             = require('../../lib/evernote');
var { createPage, listPages, parsePages } = require('../../lib/onenote');
var firestore = require('../../lib/firestore');

var app  = express();
var PORT = process.env.PORT || 3000;

// ──────────────────────────────────────────────────────────────────
// MIDDLEWARE
// ──────────────────────────────────────────────────────────────────

// Security headers
app.use(helmet({
  contentSecurityPolicy: false, // We're an API, not serving HTML
}));

// Body parsing — limit payload size to 32KB
app.use(express.json({ limit: '32kb' }));
app.use(express.urlencoded({ extended: false, limit: '32kb' }));

// Trust proxy (for X-Forwarded-For behind nginx/Cloudflare)
app.set('trust proxy', 1);

// ── CORS ──
var ALLOWED_ORIGINS = [
  process.env.ALLOWED_ORIGIN_1 || 'https://blueboop.is-a.dev',
  process.env.ALLOWED_ORIGIN_2 || 'https://nicholas-tritsaris.github.io',
  'http://localhost:3000',
  'http://127.0.0.1:5500',
];

app.use(function(req, res, next) {
  var origin = req.headers['origin'] || '';
  if (!origin || ALLOWED_ORIGINS.includes(origin)) {
    var allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
    res.setHeader('Access-Control-Allow-Origin',  allowed);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Vary', 'Origin');
  }
  if (req.method === 'OPTIONS') { return res.status(204).end(); }
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    return res.status(403).json({ error: 'origin_denied' });
  }
  next();
});

// ── RATE LIMITING ──
var globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max:      300,
  message:  { error: 'too_many_requests' },
  standardHeaders: true,
  legacyHeaders:   false,
});

var authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max:      10,
  message:  { error: 'too_many_auth_attempts' },
});

app.use('/api/', globalLimiter);
app.use('/api/auth', authLimiter);

// ──────────────────────────────────────────────────────────────────
// HELPERS
// ──────────────────────────────────────────────────────────────────

function getClientIP(req) {
  return ((req.headers['cf-connecting-ip'] ||
           req.headers['x-forwarded-for']  ||
           req.socket.remoteAddress        || '0.0.0.0') + '').split(',')[0].trim();
}

function sha256Hex(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

function sanitize(obj, depth) {
  if ((depth || 0) > 5) return {};
  if (typeof obj === 'string') return obj.replace(/<script[\s\S]*?<\/script>/gi,'').replace(/<[^>]+>/g,'').slice(0, 4096);
  if (Array.isArray(obj)) return obj.slice(0,50).map(v => sanitize(v, (depth||0)+1));
  if (obj !== null && typeof obj === 'object') {
    var out = {};
    for (var k of Object.keys(obj).slice(0, 50)) { out[k.slice(0,64)] = sanitize(obj[k], (depth||0)+1); }
    return out;
  }
  return obj;
}

function verifyCredentials(username, password) {
  if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD_HASH) return false;
  if (username !== process.env.ADMIN_USERNAME) return false;
  return sha256Hex(password) === process.env.ADMIN_PASSWORD_HASH.toLowerCase();
}

function authMiddleware(req, res, next) {
  var authHeader = req.headers['authorization'] || '';
  if (!authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'unauthorized' });
  var token = authHeader.slice(7);
  try {
    req.jwtPayload = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: 'invalid_token' });
  }
}

// ──────────────────────────────────────────────────────────────────
// ROUTES
// ──────────────────────────────────────────────────────────────────

// ── Health check ──
app.get('/health', function(req, res) {
  res.json({ status: 'operational', service: 'silhouette-tracker', uptime: process.uptime() });
});

// ── POST /api/track ──
app.post('/api/track', async function(req, res) {
  var clientIP = getClientIP(req);
  var payload  = sanitize(req.body || {});
  payload.ip   = clientIP;

  var service  = (process.env.NOTE_SERVICE || 'google-tasks').toLowerCase();
  var textFmt  = formatText(payload, clientIP);
  var htmlFmt  = formatHTML(payload, clientIP);

  try {
    switch (service) {
      case 'google-tasks': await createTask(process.env, payload, clientIP, textFmt); break;
      case 'evernote':     await createNote(process.env, payload, clientIP, textFmt, htmlFmt); break;
      case 'onenote':      await createPage(process.env, payload, clientIP, htmlFmt); break;
      case 'firestore':   await firestore.createEntry(process.env, payload, clientIP, textFmt); break;
      default: console.warn('[track] Unknown NOTE_SERVICE:', service);
    }
  } catch (e) {
    console.error('[track] note service error:', e.message);
    // Return 200 to frontend — never reveal backend errors to tracker
  }

  res.json({ status: 'ok' });
});

// ── POST /api/auth ──
app.post('/api/auth', function(req, res) {
  var { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'credentials_required' });

  var valid = verifyCredentials(String(username), String(password));
  if (!valid) return res.status(401).json({ error: 'invalid_credentials' });

  var token = jwt.sign(
    { sub: username, iss: 'silhouette' },
    process.env.JWT_SECRET,
    { expiresIn: '1h', algorithm: 'HS256' }
  );
  res.json({ token });
});

// ── GET /api/data ──
app.get('/api/data', authMiddleware, async function(req, res) {
  var service = (process.env.NOTE_SERVICE || 'google-tasks').toLowerCase();
  var entries = [];

  try {
    switch (service) {
      case 'google-tasks': {
        var items = await listTasks(process.env);
        entries = parseTasks(items);
        break;
      }
      case 'evernote': {
        entries = await listNotes(process.env);
        break;
      }
      case 'onenote': {
        var pages = await listPages(process.env);
        entries   = parsePages(pages);
        break;
      }
      case 'firestore': {
        var items = await firestore.listEntries(process.env, null);
        entries   = firestore.parseEntries(items);
        break;
      }
    }
    res.json({ entries, count: entries.length });
  } catch (e) {
    console.error('[data] fetch error:', e.message);
    res.status(502).json({ error: 'upstream_error', detail: e.message });
  }
});

// ── 404 ──
app.use(function(req, res) {
  res.status(404).json({ error: 'not_found' });
});

// ── Global error handler ──
app.use(function(err, req, res, next) {
  console.error('[unhandled error]', err.message);
  res.status(500).json({ error: 'internal_server_error' });
});

// ──────────────────────────────────────────────────────────────────
// START SERVER
// ──────────────────────────────────────────────────────────────────

// Validate required env vars on startup
var REQUIRED_ENV = ['ADMIN_USERNAME', 'ADMIN_PASSWORD_HASH', 'JWT_SECRET'];
var missing = REQUIRED_ENV.filter(k => !process.env[k]);
if (missing.length) {
  console.error('[FATAL] Missing required environment variables:', missing.join(', '));
  process.exit(1);
}

app.listen(PORT, function() {
  console.log('[silhouette-tracker] Server running on port ' + PORT);
  console.log('[silhouette-tracker] Note service: ' + (process.env.NOTE_SERVICE || 'google-tasks'));
  console.log('[silhouette-tracker] Allowed origins:', ALLOWED_ORIGINS.join(', '));
});

module.exports = app;
