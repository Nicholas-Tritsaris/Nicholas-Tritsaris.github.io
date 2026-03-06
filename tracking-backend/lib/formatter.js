/**
 * ██████ PROJECT SILHOUETTE — PAYLOAD FORMATTER ██████
 * lib/formatter.js
 *
 * Converts a raw JSON tracking payload into a structured text block
 * suitable for Evernote/Google Tasks/OneNote note content.
 */

'use strict';

/**
 * Format a tracking payload into a human-readable text block.
 * @param {Object} payload  - The JSON body received from the frontend
 * @param {string} clientIP - The resolved public IP of the visitor
 * @returns {string}        - Formatted multiline text
 */
function formatText(payload, clientIP) {
  var p = payload || {};
  var s = p.screen  || {};
  var w = p.webgl   || {};
  var b = p.battery || {};
  var c = p.connection || {};

  var lines = [
    '═══════════════════════════════════════════════════════',
    '  VISITOR RECORD',
    '═══════════════════════════════════════════════════════',
    '',
    '  [IDENTITY]',
    '  Fingerprint : ' + (p.fingerprint || 'unknown'),
    '  IP Address  : ' + (clientIP || p.ip || 'unknown'),
    '  Timestamp   : ' + (p.timestamp  || new Date().toISOString()),
    '  Page URL    : ' + (p.page       || 'unknown'),
    '  Referrer    : ' + (p.referrer   || 'direct'),
    '',
    '  [BROWSER & OS]',
    '  Browser     : ' + (p.browser    || 'unknown'),
    '  OS          : ' + (p.os         || 'unknown'),
    '  Platform    : ' + (p.platform   || 'unknown'),
    '  Locale      : ' + (p.locale     || 'unknown'),
    '  Languages   : ' + (Array.isArray(p.languages) ? p.languages.join(', ') : (p.languages || 'unknown')),
    '  DNT         : ' + (p.doNotTrack  || 'unset'),
    '  Cookies     : ' + (p.cookiesEnabled ? 'enabled' : 'disabled'),
    '  PDF Viewer  : ' + (p.pdfViewer !== null && p.pdfViewer !== undefined ? String(p.pdfViewer) : 'unknown'),
    '  Vendor      : ' + (p.vendor     || 'unknown'),
    '',
    '  [SCREEN & DISPLAY]',
    '  Resolution  : ' + (s.width || '?') + ' × ' + (s.height || '?'),
    '  Avail Area  : ' + (s.availWidth || '?') + ' × ' + (s.availHeight || '?'),
    '  Color Depth : ' + (s.colorDepth !== null && s.colorDepth !== undefined ? s.colorDepth + ' bit' : 'unknown'),
    '  Pixel Ratio : ' + (s.devicePixelRatio || 'unknown'),
    '  Orientation : ' + (s.orientation || 'unknown'),
    '',
    '  [HARDWARE]',
    '  GPU Renderer: ' + (w.renderer || 'unavailable'),
    '  GPU Vendor  : ' + (w.vendor   || 'unavailable'),
    '  Device RAM  : ' + (p.deviceMemory !== null && p.deviceMemory !== undefined ? p.deviceMemory + ' GB' : 'unknown'),
    '  CPU Cores   : ' + (p.hardwareConcurrency || 'unknown'),
    '  Touch Points: ' + (p.touchPoints !== null && p.touchPoints !== undefined ? p.touchPoints : 'unknown'),
    '',
    '  [NETWORK]',
    '  Conn Type   : ' + (c.type     || 'unknown'),
    '  Downlink    : ' + (c.downlink !== null && c.downlink !== undefined ? c.downlink + ' Mbps' : 'unknown'),
    '  RTT         : ' + (c.rtt      !== null && c.rtt !== undefined ? c.rtt + ' ms' : 'unknown'),
    '  Save Data   : ' + (c.saveData !== null && c.saveData !== undefined ? String(c.saveData) : 'unknown'),
    '  WebRTC IP   : ' + (p.webrtcIP || 'unavailable'),
    '',
    '  [DEVICE & PRIVACY]',
    '  Battery     : ' + (b.level !== null && b.level !== undefined ? Math.round(b.level * 100) + '%' : 'unknown'),
    '  Charging    : ' + (b.charging !== null && b.charging !== undefined ? String(b.charging) : 'unknown'),
    '  Timezone    : ' + (p.timezone  || 'unknown'),
    '  Adblock     : ' + (p.adblockDetected ? 'DETECTED' : 'not detected'),
    '  Incognito   : ' + (p.incognitoMode || 'unknown'),
    '',
    '  [RAW USER AGENT]',
    '  ' + (p.userAgent || 'unknown'),
    '',
    '═══════════════════════════════════════════════════════',
  ];

  return lines.join('\n');
}

/**
 * Format a tracking payload into an HTML fragment (for OneNote + Evernote).
 * @param {Object} payload
 * @param {string} clientIP
 * @returns {string} - HTML string
 */
function formatHTML(payload, clientIP) {
  var p = payload || {};
  var s = p.screen  || {};
  var w = p.webgl   || {};
  var b = p.battery || {};
  var c = p.connection || {};

  function row(label, value) {
    return '<tr>' +
      '<td style="padding:4px 10px;color:#336699;font-weight:bold;white-space:nowrap;">' + esc(label) + '</td>' +
      '<td style="padding:4px 10px;color:#333333;font-family:monospace;">' + esc(String(value !== null && value !== undefined ? value : '—')) + '</td>' +
      '</tr>';
  }

  function section(title, rows) {
    return '<tr><td colspan="2" style="background:#003366;color:#ffffff;font-weight:bold;padding:6px 10px;">' + esc(title) + '</td></tr>' + rows.join('');
  }

  function esc(s) {
    return String(s || '').replace(/&/g,'&').replace(/</g,'<').replace(/>/g,'>').replace(/"/g,'"');
  }

  var html = [
    '<table border="1" cellpadding="4" cellspacing="0" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px;min-width:500px;">',
    section('IDENTITY', [
      row('Fingerprint',  p.fingerprint),
      row('IP Address',   clientIP || p.ip),
      row('Timestamp',    p.timestamp),
      row('Page URL',     p.page),
      row('Referrer',     p.referrer || 'direct'),
    ]),
    section('BROWSER & OS', [
      row('Browser',      p.browser),
      row('OS',           p.os),
      row('Platform',     p.platform),
      row('Locale',       p.locale),
      row('Languages',    Array.isArray(p.languages) ? p.languages.join(', ') : p.languages),
      row('DNT',          p.doNotTrack),
      row('Cookies',      p.cookiesEnabled),
    ]),
    section('SCREEN & DISPLAY', [
      row('Resolution',   (s.width || '?') + ' × ' + (s.height || '?')),
      row('Color Depth',  s.colorDepth !== null && s.colorDepth !== undefined ? s.colorDepth + ' bit' : '—'),
      row('Pixel Ratio',  s.devicePixelRatio),
      row('Orientation',  s.orientation),
    ]),
    section('HARDWARE', [
      row('GPU Renderer', w.renderer),
      row('GPU Vendor',   w.vendor),
      row('Device RAM',   p.deviceMemory !== null && p.deviceMemory !== undefined ? p.deviceMemory + ' GB' : '—'),
      row('CPU Cores',    p.hardwareConcurrency),
      row('Touch Points', p.touchPoints),
    ]),
    section('NETWORK', [
      row('Conn Type',    c.type),
      row('Downlink',     c.downlink !== null && c.downlink !== undefined ? c.downlink + ' Mbps' : '—'),
      row('RTT',          c.rtt !== null && c.rtt !== undefined ? c.rtt + ' ms' : '—'),
      row('WebRTC IP',    p.webrtcIP),
    ]),
    section('DEVICE & PRIVACY', [
      row('Battery',      b.level !== null && b.level !== undefined ? Math.round(b.level * 100) + '%' : '—'),
      row('Charging',     b.charging),
      row('Timezone',     p.timezone),
      row('Adblock',      p.adblockDetected ? 'DETECTED' : 'not detected'),
      row('Incognito',    p.incognitoMode),
    ]),
    '</table>',
    '<p style="font-size:11px;color:#999;margin-top:8px;">User Agent: ' + esc(p.userAgent || '—') + '</p>',
  ].join('');

  return html;
}

module.exports = { formatText, formatHTML };
