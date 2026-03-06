/**
 * ██████ PROJECT SILHOUETTE — VERCEL: POST /api/auth ██████
 * api/auth.js
 */
'use strict';

var { setCORSHeaders, isOriginAllowed, getClientIP, signToken, verifyCredentials, checkRateLimit } = require('../lib/shared');

module.exports = async function(req, res) {
  var origin = req.headers['origin'] || '';
  setCORSHeaders(res, origin);

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (!isOriginAllowed(origin))  { res.status(403).json({ error: 'origin_denied' }); return; }
  if (req.method !== 'POST')     { res.status(405).json({ error: 'method_not_allowed' }); return; }

  var ip = getClientIP(req);
  if (!checkRateLimit(ip)) { res.status(429).json({ error: 'too_many_requests' }); return; }

  var { username, password } = req.body || {};
  if (!username || !password) { res.status(400).json({ error: 'credentials_required' }); return; }

  var valid = verifyCredentials(String(username), String(password));
  if (!valid) { res.status(401).json({ error: 'invalid_credentials' }); return; }

  var token = signToken(username);
  res.status(200).json({ token });
};
