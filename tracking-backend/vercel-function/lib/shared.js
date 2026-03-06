/**
 * Shared utilities for all Vercel serverless functions.
 * lib/shared.js
 */
'use strict';

var crypto = require('crypto');
var jwt    = require('jsonwebtoken');

var ALLOWED_ORIGINS = [
  process.env.ALLOWED_ORIGIN_1 || 'https://blueboop.is-a.dev',
  process.env.ALLOWED_ORIGIN_2 || 'https://nicholas-tritsaris.github.io',
  'http://localhost:3000',
  'http://127.0.0.1:5500',
];

function setCORSHeaders(res, origin) {
  var allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  res.setHeader('Access-Control-Allow-Origin',  allowed);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Vary', 'Origin');
}

function handleOptions(req, res) {
  var origin = req.headers['origin'] || '';
  setCORSHeaders(res, origin);
  res.status(204).end();
  return true;
}

function isOriginAllowed(origin) {
  return !origin || ALLOWED_ORIGINS.includes(origin);
}

function getClientIP(req) {
  return (req.headers['cf-connecting-ip'] ||
          req.headers['x-forwarded-for']  ||
          req.socket.remoteAddress        || '0.0.0.0').split(',')[0].trim();
}

function sha256Hex(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

function sanitizeStr(s, maxLen) {
  return String(s || '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, '').slice(0, maxLen || 4096);
}

function sanitize(obj, depth) {
  if ((depth || 0) > 5) return {};
  if (typeof obj === 'string') return sanitizeStr(obj);
  if (Array.isArray(obj))  return obj.slice(0, 50).map(v => sanitize(v, (depth||0)+1));
  if (obj !== null && typeof obj === 'object') {
    var out = {};
    for (var k of Object.keys(obj).slice(0, 50)) {
      out[sanitizeStr(k, 64)] = sanitize(obj[k], (depth||0)+1);
    }
    return out;
  }
  return obj;
}

function signToken(username) {
  return jwt.sign(
    { sub: username, iss: 'silhouette' },
    process.env.JWT_SECRET,
    { expiresIn: '1h', algorithm: 'HS256' }
  );
}

function verifyToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  var token = authHeader.slice(7);
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (e) {
    return null;
  }
}

function verifyCredentials(username, password) {
  if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD_HASH) return false;
  if (username !== process.env.ADMIN_USERNAME) return false;
  var inputHash = sha256Hex(password);
  return inputHash === process.env.ADMIN_PASSWORD_HASH.toLowerCase();
}

// Simple in-memory rate limiter
var _authAttempts = new Map();
function checkRateLimit(ip) {
  var now   = Date.now();
  var entry = _authAttempts.get(ip);
  if (!entry || (now - entry.firstTry) > 15 * 60 * 1000) {
    _authAttempts.set(ip, { count: 1, firstTry: now });
    return true;
  }
  if (entry.count >= 10) return false;
  entry.count++;
  return true;
}

module.exports = {
  setCORSHeaders,
  handleOptions,
  isOriginAllowed,
  getClientIP,
  sanitize,
  signToken,
  verifyToken,
  verifyCredentials,
  checkRateLimit,
};
