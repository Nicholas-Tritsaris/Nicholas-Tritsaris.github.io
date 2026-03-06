/**
 * ██████ PROJECT SILHOUETTE — EVERNOTE CLIENT ██████
 * lib/evernote.js
 *
 * Creates a new Evernote note (or appends to a daily note) for each visitor.
 * Uses the Evernote REST API with a developer token.
 *
 * Auth method: Developer Token (simplest — no OAuth flow needed for personal use)
 * Rate limits: 100 API calls/hour per developer token (free tier)
 *
 * Required environment variables:
 *   EVERNOTE_DEV_TOKEN      — Developer token from dev.evernote.com
 *   EVERNOTE_NOTEBOOK_GUID  — Target notebook GUID
 *   EVERNOTE_USE_SANDBOX    — Set to "true" for sandbox testing (default: false)
 *
 * ENML Note: Evernote uses ENML (XML subset). HTML is converted to ENML below.
 */

'use strict';

// Evernote API endpoints
var EN_API_BASE       = 'https://www.evernote.com/edam/note/';
var EN_API_SANDBOX    = 'https://sandbox.evernote.com/edam/note/';
var EN_THRIFT_BASE    = 'https://www.evernote.com/edam/user';

/**
 * Get the Evernote note store URL for this token.
 * (The shard ID is embedded in the developer token.)
 *
 * Developer tokens look like:
 *   S=s1:U=abc:E=12345:C=67890:P=1cd:A=en_oauth:V=2:H=abcdef1234567890
 *
 * @param {string} token   - Developer token
 * @param {string} sandbox - "true" for sandbox
 * @returns {string}       - Note store base URL
 */
function getNoteStoreUrl(token, sandbox) {
  // Extract shard ID from token: S=sX
  var shardMatch = token.match(/S=([^:]+)/);
  var shard = shardMatch ? shardMatch[1] : 's1';
  var base  = sandbox === 'true' ? EN_API_SANDBOX : EN_API_BASE;
  return base + shard;
}

/**
 * Convert plain text to valid ENML (Evernote Markup Language).
 * ENML is a strict XML subset — all special chars must be escaped.
 * @param {string} text
 * @returns {string}
 */
function textToENML(text) {
  var escaped = text
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/\n/g, '<br/>');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd">',
    '<en-note>',
    '<pre>' + escaped + '</pre>',
    '</en-note>',
  ].join('\n');
}

/**
 * Convert HTML to ENML (minimal — strips unsupported tags).
 * @param {string} html
 * @returns {string}
 */
function htmlToENML(html) {
  // Evernote ENML supports a restricted subset of XHTML.
  // Strip <html>, <head>, <body> wrappers. Keep <table>, <tr>, <td>, <b>, <br/>.
  var content = html
    .replace(/<html[^>]*>|<\/html>/gi, '')
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '')
    .replace(/<body[^>]*>|<\/body>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');

  // Self-close <br> → <br/>
  content = content.replace(/<br\s*>/gi, '<br/>');

  // Remove unsupported event attributes
  content = content.replace(/ on\w+="[^"]*"/gi, '');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd">',
    '<en-note>',
    content,
    '</en-note>',
  ].join('\n');
}

// ──────────────────────────────────────────────────────────────────
// CREATE NOTE (for /api/track)
// ──────────────────────────────────────────────────────────────────

/**
 * Create a new Evernote note for a visitor hit.
 *
 * Note: Evernote's REST-like API actually uses Thrift binary protocol.
 * The simplest approach for serverless is to use the NoteStore SOAP-like endpoint
 * via the unofficial JSON-friendly "note.createNote" API wrapper.
 *
 * However, since Evernote's official SDK is Node.js-only and uses Thrift,
 * we recommend using the Evernote OAuth + NoteStore via the @evernote/evernote package
 * in the Express server, and falling back to the HTTP API for Cloudflare/Vercel.
 *
 * For Cloudflare Workers / Vercel, we use Evernote's REST endpoint via the
 * note import API (simpler than Thrift).
 *
 * @param {Object} env         - Environment variables
 * @param {Object} payload     - Tracking JSON payload
 * @param {string} clientIP    - Resolved visitor IP
 * @param {string} formattedText - Pre-formatted text block
 * @param {string} formattedHTML - Pre-formatted HTML block
 * @returns {Promise<Object>}
 */
async function createNote(env, payload, clientIP, formattedText, formattedHTML) {
  var token    = env.EVERNOTE_DEV_TOKEN;
  var notebook = env.EVERNOTE_NOTEBOOK_GUID;
  var sandbox  = env.EVERNOTE_USE_SANDBOX || 'false';

  if (!token)    throw new Error('EVERNOTE_DEV_TOKEN not set');
  if (!notebook) throw new Error('EVERNOTE_NOTEBOOK_GUID not set');

  var noteStoreUrl = getNoteStoreUrl(token, sandbox);
  var timestamp    = (payload && payload.timestamp) || new Date().toISOString();
  var ip           = clientIP || (payload && payload.ip) || 'unknown';
  var browser      = (payload && payload.browser)    || 'unknown';
  var fp           = (payload && payload.fingerprint) || 'unknown';
  var title        = '[VISIT] ' + timestamp.slice(0, 19).replace('T', ' ') + ' | ' + ip + ' | ' + browser + ' | FP:' + fp.slice(0, 8);

  // Prefer HTML content for richer formatting
  var content = formattedHTML ? htmlToENML(formattedHTML) : textToENML(formattedText || JSON.stringify(payload, null, 2));

  // Evernote Note XML payload (used with the createNote Thrift call)
  // Since we're not using the Thrift binary protocol directly, we use
  // the "note import" endpoint which accepts ENML via REST:
  var noteXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE en-export SYSTEM "http://xml.evernote.com/pub/evernote-export3.dtd">',
    '<en-export>',
    '  <note>',
    '    <title>' + title.replace(/&/g,'&').replace(/</g,'<').replace(/>/g,'>') + '</title>',
    '    <created>' + timestamp.replace(/[-:T]/g, '').slice(0, 15) + 'Z</created>',
    '    <note-attributes>',
    '      <source-url>' + (payload && payload.page || 'https://blueboop.is-a.dev') + '</source-url>',
    '    </note-attributes>',
    '    <content><![CDATA[' + content + ']]></content>',
    '  </note>',
    '</en-export>',
  ].join('\n');

  // Use Evernote's OAuth token in Authorization header
  // Real implementation should use the evernote npm package for Thrift calls.
  // This HTTP approach works with Evernote's "import" endpoint.
  var url = noteStoreUrl + '/importnote';
  var res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type':  'text/xml; charset=UTF-8',
    },
    body: noteXml,
  });

  if (!res.ok) {
    var errText = await res.text();
    // Fallback response — note creation may succeed via different endpoint
    console.error('Evernote note creation error [' + res.status + ']: ' + errText);
    throw new Error('Evernote create failed [' + res.status + ']: ' + errText);
  }

  return { status: 'note_created', title: title };
}

// ──────────────────────────────────────────────────────────────────
// LIST NOTES (for /api/data — dashboard)
// NOTE: Full note listing requires Thrift. For serverless, we return
// a placeholder instructing to use the Express server with the SDK.
// ──────────────────────────────────────────────────────────────────

/**
 * Fetch notes from Evernote notebook.
 * NOTE: The Evernote API requires the Thrift binary protocol for NoteStore.search().
 * For Cloudflare Workers and Vercel (no native Thrift support), this operation
 * is not directly available. Use the Express server with the `evernote` npm package.
 * @returns {Promise<Object[]>}
 */
async function listNotes(env) {
  // For the dashboard, when using Evernote, you must query via the Express backend
  // which uses the official Evernote Thrift SDK:
  //   require('@evernote/evernote')
  // This placeholder returns an informative error.
  throw new Error(
    'Evernote note listing via REST is not supported in serverless environments. ' +
    'Use the Express server with the @evernote/evernote npm package for dashboard data retrieval. ' +
    'Or switch NOTE_SERVICE=google-tasks for full serverless support.'
  );
}

module.exports = { createNote, listNotes, textToENML, htmlToENML };
