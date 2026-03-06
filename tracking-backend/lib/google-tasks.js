/**
 * ██████ PROJECT SILHOUETTE — GOOGLE TASKS CLIENT ██████
 * lib/google-tasks.js
 *
 * Creates a new Google Task in a designated task list for each visitor hit.
 * Also supports fetching all tasks for the dashboard.
 *
 * Auth method: OAuth 2.0 offline access (refresh token)
 * Rate limits: ~50,000 requests/day per project (free)
 *
 * Required environment variables:
 *   GOOGLE_CLIENT_ID       — OAuth 2.0 client ID
 *   GOOGLE_CLIENT_SECRET   — OAuth 2.0 client secret
 *   GOOGLE_REFRESH_TOKEN   — Offline refresh token (never expires unless revoked)
 *   GOOGLE_TASKLIST_ID     — Target task list ID (e.g. "MDEzNTgxMzI...")
 */

'use strict';

var TOKEN_URL    = 'https://oauth2.googleapis.com/token';
var TASKS_BASE   = 'https://tasks.googleapis.com/tasks/v1';

// ──────────────────────────────────────────────────────────────────
// TOKEN MANAGEMENT
// ──────────────────────────────────────────────────────────────────

// In-memory access token cache (refreshed every ~55 minutes)
var _cachedToken = null;
var _tokenExpiry = 0;

/**
 * Get a valid access token, refreshing if necessary.
 * @param {Object} env - Environment variables
 * @returns {Promise<string>} - Access token
 */
async function getAccessToken(env) {
  var now = Date.now();

  if (_cachedToken && now < _tokenExpiry - 60000) {
    return _cachedToken;
  }

  var res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: env.GOOGLE_REFRESH_TOKEN,
      grant_type:    'refresh_token',
    }).toString(),
  });

  if (!res.ok) {
    var errBody = await res.text();
    throw new Error('Google token refresh failed: ' + errBody);
  }

  var data = await res.json();
  _cachedToken = data.access_token;
  _tokenExpiry = now + (data.expires_in || 3600) * 1000;
  return _cachedToken;
}

// ──────────────────────────────────────────────────────────────────
// CREATE TASK (for /api/track)
// ──────────────────────────────────────────────────────────────────

/**
 * Create a new task in the designated task list.
 * @param {Object} env       - Environment variables
 * @param {Object} payload   - Tracking JSON payload
 * @param {string} clientIP  - Resolved visitor IP
 * @param {string} formatted - Pre-formatted text block
 * @returns {Promise<Object>} - Created task resource
 */
async function createTask(env, payload, clientIP, formatted) {
  var token     = await getAccessToken(env);
  var listId    = env.GOOGLE_TASKLIST_ID;
  var timestamp = (payload && payload.timestamp) || new Date().toISOString();
  var fp        = (payload && payload.fingerprint) || 'unknown';
  var browser   = (payload && payload.browser)     || 'unknown';
  var os        = (payload && payload.os)          || 'unknown';
  var ip        = clientIP || (payload && payload.ip) || 'unknown';

  // Task title: short summary (Google Tasks title max ~1024 chars, notes max 8192)
  var title = '[VISIT] ' + timestamp.slice(0, 19).replace('T', ' ') +
              ' | ' + ip + ' | ' + browser + ' | ' + os +
              ' | FP: ' + fp.slice(0, 8);

  // Task notes: full structured text (truncated to 8000 chars to stay safe)
  var notes = formatted ? formatted.slice(0, 8000) : JSON.stringify(payload, null, 2).slice(0, 8000);

  var body = JSON.stringify({
    title: title,
    notes: notes,
    status: 'needsAction'
  });

  var url = TASKS_BASE + '/lists/' + encodeURIComponent(listId) + '/tasks';
  var res = await fetch(url, {
    method:  'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type':  'application/json',
    },
    body: body,
  });

  if (!res.ok) {
    var errText = await res.text();
    throw new Error('Google Tasks create failed [' + res.status + ']: ' + errText);
  }

  return res.json();
}

// ──────────────────────────────────────────────────────────────────
// LIST ALL TASKS (for /api/data — dashboard)
// ──────────────────────────────────────────────────────────────────

/**
 * Fetch all tasks from the task list (paginated, up to maxResults per call).
 * @param {Object} env    - Environment variables
 * @param {number} [max]  - Max tasks to fetch (default 500)
 * @returns {Promise<Object[]>} - Array of raw task objects
 */
async function listTasks(env, max) {
  var token  = await getAccessToken(env);
  var listId = env.GOOGLE_TASKLIST_ID;
  var tasks  = [];
  var pageToken = null;
  var perPage   = Math.min(max || 500, 100); // API max per page is 100

  do {
    var qs = new URLSearchParams({
      maxResults:   perPage,
      showCompleted: 'true',
      showHidden:   'true',
      showDeleted:  'false',
    });
    if (pageToken) qs.set('pageToken', pageToken);

    var url = TASKS_BASE + '/lists/' + encodeURIComponent(listId) + '/tasks?' + qs.toString();
    var res = await fetch(url, {
      headers: { 'Authorization': 'Bearer ' + token },
    });

    if (!res.ok) {
      var errText = await res.text();
      throw new Error('Google Tasks list failed [' + res.status + ']: ' + errText);
    }

    var data = await res.json();
    if (data.items) tasks = tasks.concat(data.items);
    pageToken = data.nextPageToken || null;

    if (max && tasks.length >= max) break;
  } while (pageToken);

  return tasks;
}

/**
 * Parse raw Google Tasks items into the unified entry format used by the dashboard.
 * @param {Object[]} items - Raw task items from Google Tasks API
 * @returns {Object[]}     - Normalized entry array
 */
function parseTasks(items) {
  return (items || []).map(function (task) {
    var notes = task.notes || '';

    // Try to extract JSON from the notes field (stored as JSON by newer entries)
    var entry = {};
    try {
      // The notes might start with JSON blob or the formatted text block
      var jsonMatch = notes.match(/^\{[\s\S]*\}/);
      if (jsonMatch) entry = JSON.parse(jsonMatch[0]);
    } catch (e) {}

    // Fallback: parse from title
    if (!entry.timestamp) {
      var titleMatch = (task.title || '').match(/\[VISIT\] (\S+ \S+) \| (\S+) \| (.+?) \| (.+?) \| FP: (\w+)/);
      if (titleMatch) {
        entry.timestamp  = titleMatch[1].replace(' ', 'T') + ':00.000Z';
        entry.ip         = titleMatch[2];
        entry.browser    = titleMatch[3];
        entry.os         = titleMatch[4];
        entry.fingerprint = titleMatch[5];
      }
    }

    entry._taskId    = task.id;
    entry._taskTitle = task.title;
    entry._raw_notes = notes.slice(0, 200);

    return entry;
  });
}

module.exports = { createTask, listTasks, parseTasks, getAccessToken };
