/**
 * ██████ PROJECT SILHOUETTE — VERCEL: GET /api/data ██████
 * api/data.js
 */
'use strict';

var { setCORSHeaders, isOriginAllowed, verifyToken } = require('../lib/shared');
var { listTasks, parseTasks }  = require('../../lib/google-tasks');
var { listNotes }              = require('../../lib/evernote');
var { listPages, parsePages }  = require('../../lib/onenote');

module.exports = async function(req, res) {
  var origin = req.headers['origin'] || '';
  setCORSHeaders(res, origin);

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (!isOriginAllowed(origin))  { res.status(403).json({ error: 'origin_denied' }); return; }
  if (req.method !== 'GET')      { res.status(405).json({ error: 'method_not_allowed' }); return; }

  var jwtPayload = verifyToken(req.headers['authorization'] || '');
  if (!jwtPayload) { res.status(401).json({ error: 'unauthorized' }); return; }

  var service = (process.env.NOTE_SERVICE || 'google-tasks').toLowerCase();
  var entries = [];

  try {
    switch (service) {
      case 'google-tasks': {
        var items = await listTasks(process.env);
        entries   = parseTasks(items);
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
    }
    res.status(200).json({ entries, count: entries.length });
  } catch (e) {
    console.error('[data] fetch error:', e.message);
    res.status(502).json({ error: 'upstream_error', detail: e.message });
  }
};
