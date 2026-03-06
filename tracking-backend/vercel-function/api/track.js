/**
 * ██████ PROJECT SILHOUETTE — VERCEL: POST /api/track ██████
 * api/track.js
 *
 * Receives visitor fingerprint payload and stores to note service.
 */
'use strict';

var { setCORSHeaders, handleOptions, isOriginAllowed, getClientIP, sanitize } = require('../lib/shared');
var { formatText, formatHTML } = require('../../lib/formatter');
var { createTask } = require('../../lib/google-tasks');
var { createNote } = require('../../lib/evernote');
var { createPage } = require('../../lib/onenote');

module.exports = async function(req, res) {
  var origin = req.headers['origin'] || '';
  setCORSHeaders(res, origin);

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (!isOriginAllowed(origin))  { res.status(403).json({ error: 'origin_denied' }); return; }
  if (req.method !== 'POST')     { res.status(405).json({ error: 'method_not_allowed' }); return; }

  var ct = (req.headers['content-type'] || '');
  if (!ct.includes('application/json')) { res.status(415).json({ error: 'content_type_required' }); return; }

  var payload = req.body;
  if (!payload || typeof payload !== 'object') { res.status(400).json({ error: 'invalid_payload' }); return; }

  var clientIP = getClientIP(req);
  payload = sanitize(payload);
  payload.ip = clientIP;

  var service = (process.env.NOTE_SERVICE || 'google-tasks').toLowerCase();
  var textFmt = formatText(payload, clientIP);
  var htmlFmt = formatHTML(payload, clientIP);

  try {
    switch (service) {
      case 'google-tasks': await createTask(process.env, payload, clientIP, textFmt); break;
      case 'evernote':     await createNote(process.env, payload, clientIP, textFmt, htmlFmt); break;
      case 'onenote':      await createPage(process.env, payload, clientIP, htmlFmt); break;
    }
  } catch (e) {
    console.error('[track] note service error:', e.message);
    // Return 200 to frontend — never reveal backend errors
  }

  res.status(200).json({ status: 'ok' });
};
