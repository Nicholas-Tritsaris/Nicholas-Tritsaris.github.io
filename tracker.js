/**
 * ██████ PROJECT SILHOUETTE — VISITOR INTELLIGENCE COLLECTOR ██████
 * tracker.js — Unminified source (development reference)
 * 
 * Collects 25+ device signals, builds a SHA-256 fingerprint hash,
 * and POSTs the payload to the configured backend endpoint.
 * 
 * Dependencies: None (pure vanilla JS, Web Crypto API)
 * Target: Modern browsers (Chrome 60+, Firefox 57+, Safari 12+, Edge 79+)
 */

(function () {
  'use strict';

  // ─────────────────────────────────────────────────────────────────────────────
  // CONFIGURATION — Update BACKEND_URL before deployment
  // ─────────────────────────────────────────────────────────────────────────────
  var BACKEND_URL = 'https://YOUR_WORKER.YOUR_SUBDOMAIN.workers.dev/api/track';
  var SEND_TIMEOUT_MS = 8000;

  // ─────────────────────────────────────────────────────────────────────────────
  // UTILITY: Parse browser name + version from user agent
  // ─────────────────────────────────────────────────────────────────────────────
  function parseBrowser(ua) {
    var browsers = [
      { name: 'Edge',    regex: /Edg(?:e|\/)([\d.]+)/ },
      { name: 'Chrome',  regex: /Chrome\/([\d.]+)/ },
      { name: 'Firefox', regex: /Firefox\/([\d.]+)/ },
      { name: 'Safari',  regex: /Version\/([\d.]+).*Safari/ },
      { name: 'Opera',   regex: /OPR\/([\d.]+)/ },
      { name: 'IE',      regex: /MSIE ([\d.]+)|Trident.*rv:([\d.]+)/ },
    ];
    for (var i = 0; i < browsers.length; i++) {
      var m = ua.match(browsers[i].regex);
      if (m) return browsers[i].name + ' ' + (m[1] || m[2] || '');
    }
    return 'Unknown';
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // UTILITY: Parse OS name + version from user agent
  // ─────────────────────────────────────────────────────────────────────────────
  function parseOS(ua) {
    var oses = [
      { name: 'Windows 11',   regex: /Windows NT 10\.0.*Win64/ },
      { name: 'Windows 10',   regex: /Windows NT 10\.0/ },
      { name: 'Windows 8.1',  regex: /Windows NT 6\.3/ },
      { name: 'Windows 8',    regex: /Windows NT 6\.2/ },
      { name: 'Windows 7',    regex: /Windows NT 6\.1/ },
      { name: 'macOS',        regex: /Mac OS X ([\d_]+)/ },
      { name: 'iOS',          regex: /iPhone OS ([\d_]+)/ },
      { name: 'iPadOS',       regex: /iPad.*OS ([\d_]+)/ },
      { name: 'Android',      regex: /Android ([\d.]+)/ },
      { name: 'Linux',        regex: /Linux/ },
      { name: 'ChromeOS',     regex: /CrOS/ },
    ];
    for (var i = 0; i < oses.length; i++) {
      var m = ua.match(oses[i].regex);
      if (m) {
        var version = m[1] ? m[1].replace(/_/g, '.') : '';
        return oses[i].name + (version ? ' ' + version : '');
      }
    }
    return 'Unknown';
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // COLLECTION: WebGL GPU renderer + vendor
  // ─────────────────────────────────────────────────────────────────────────────
  function getWebGL() {
    try {
      var canvas = document.createElement('canvas');
      var gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (!gl) return { renderer: 'unavailable', vendor: 'unavailable' };
      var ext = gl.getExtension('WEBGL_debug_renderer_info');
      if (!ext) return { renderer: 'blocked', vendor: 'blocked' };
      return {
        renderer: gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || 'unknown',
        vendor:   gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)   || 'unknown'
      };
    } catch (e) {
      return { renderer: 'error', vendor: 'error' };
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // COLLECTION: Battery status
  // ─────────────────────────────────────────────────────────────────────────────
  function getBattery() {
    return new Promise(function (resolve) {
      if (!navigator.getBattery) return resolve({ level: null, charging: null });
      navigator.getBattery().then(function (b) {
        resolve({ level: Math.round(b.level * 100) / 100, charging: b.charging });
      }).catch(function () {
        resolve({ level: null, charging: null });
      });
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // COLLECTION: Adblock detection via bait element
  // ─────────────────────────────────────────────────────────────────────────────
  function detectAdblock() {
    return new Promise(function (resolve) {
      try {
        var bait = document.createElement('div');
        bait.className = 'adsbox ad-placement banner-ads pub_300x250';
        bait.style.cssText = 'position:absolute;top:-9999px;left:-9999px;width:1px;height:1px;';
        document.body.appendChild(bait);
        setTimeout(function () {
          var blocked = bait.offsetWidth === 0 || bait.offsetHeight === 0 ||
                        window.getComputedStyle(bait).display === 'none' ||
                        window.getComputedStyle(bait).visibility === 'hidden';
          document.body.removeChild(bait);
          resolve(blocked);
        }, 100);
      } catch (e) {
        resolve(false);
      }
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // COLLECTION: Incognito mode detection via storage quota heuristic
  // ─────────────────────────────────────────────────────────────────────────────
  function detectIncognito() {
    return new Promise(function (resolve) {
      try {
        if ('storage' in navigator && 'estimate' in navigator.storage) {
          navigator.storage.estimate().then(function (quota) {
            // Incognito typically has much smaller quota (< 120MB)
            if (quota.quota < 120 * 1024 * 1024) {
              resolve('likely');
            } else {
              resolve('unlikely');
            }
          }).catch(function () { resolve('unknown'); });
        } else {
          // Fallback: try filesystem API (WebKit)
          var fs = window.webkitRequestFileSystem || window.RequestFileSystem;
          if (fs) {
            fs(window.TEMPORARY, 100, function () { resolve('unlikely'); }, function () { resolve('likely'); });
          } else {
            resolve('unknown');
          }
        }
      } catch (e) {
        resolve('unknown');
      }
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // COLLECTION: WebRTC local IP via ICE candidate parsing
  // ─────────────────────────────────────────────────────────────────────────────
  function getWebRTCIP() {
    return new Promise(function (resolve) {
      try {
        var RTCPeer = window.RTCPeerConnection || window.webkitRTCPeerConnection || window.mozRTCPeerConnection;
        if (!RTCPeer) return resolve('unavailable');
        var pc = new RTCPeer({ iceServers: [] });
        var ips = [];
        pc.createDataChannel('');
        pc.createOffer().then(function (offer) {
          return pc.setLocalDescription(offer);
        }).catch(function () { resolve('unavailable'); });
        pc.onicecandidate = function (e) {
          if (!e || !e.candidate) {
            pc.close();
            resolve(ips.length ? ips[0] : 'unavailable');
            return;
          }
          var match = /([0-9]{1,3}(?:\.[0-9]{1,3}){3})/.exec(e.candidate.candidate);
          if (match && ips.indexOf(match[1]) === -1) ips.push(match[1]);
        };
        setTimeout(function () {
          try { pc.close(); } catch (ex) {}
          resolve(ips.length ? ips[0] : 'unavailable');
        }, 1500);
      } catch (e) {
        resolve('unavailable');
      }
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // COLLECTION: Screen metrics
  // ─────────────────────────────────────────────────────────────────────────────
  function getScreen() {
    var orientation = 'unknown';
    try {
      orientation = (screen.orientation && screen.orientation.type) || 'unknown';
    } catch (e) {}
    return {
      width:       screen.width       || 0,
      height:      screen.height      || 0,
      availWidth:  screen.availWidth  || 0,
      availHeight: screen.availHeight || 0,
      colorDepth:  screen.colorDepth  || null,
      pixelDepth:  screen.pixelDepth  || null,
      devicePixelRatio: window.devicePixelRatio || null,
      orientation: orientation
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // COLLECTION: Connection info
  // ─────────────────────────────────────────────────────────────────────────────
  function getConnection() {
    var conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!conn) return { type: 'unknown', downlink: null, rtt: null, saveData: null };
    return {
      type:      conn.effectiveType || 'unknown',
      downlink:  conn.downlink      || null,
      rtt:       conn.rtt           || null,
      saveData:  conn.saveData      || null
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // HASH: SHA-256 fingerprint via Web Crypto API
  // ─────────────────────────────────────────────────────────────────────────────
  function sha256(str) {
    if (!window.crypto || !window.crypto.subtle) {
      // Fallback: simple hash (not cryptographic, but stable)
      var hash = 0;
      for (var i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0;
      }
      return Promise.resolve(Math.abs(hash).toString(16).padStart(8, '0'));
    }
    var encoder = new TextEncoder();
    var data = encoder.encode(str);
    return window.crypto.subtle.digest('SHA-256', data).then(function (hashBuffer) {
      var hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // MAIN: Collect all signals, build fingerprint, POST to backend
  // ─────────────────────────────────────────────────────────────────────────────
  function collect() {
    var ua = navigator.userAgent || '';
    var screenData = getScreen();
    var connData   = getConnection();
    var webglData  = getWebGL();

    var tz = 'UTC';
    var locale = navigator.language || 'en';
    try {
      tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch (e) {}

    // Build the canonical fingerprint string from deterministic signals
    var fpStr = [
      ua,
      screenData.width,
      screenData.height,
      screenData.colorDepth,
      tz,
      locale,
      webglData.renderer,
      navigator.platform || '',
      navigator.hardwareConcurrency || '',
      navigator.deviceMemory || '',
      navigator.maxTouchPoints || 0
    ].join('|');

    var doNotTrack = 'unset';
    if (navigator.doNotTrack !== null && navigator.doNotTrack !== undefined) {
      doNotTrack = navigator.doNotTrack;
    } else if (window.doNotTrack) {
      doNotTrack = window.doNotTrack;
    }

    // Kick off async collections in parallel
    Promise.all([
      sha256(fpStr),
      getBattery(),
      detectAdblock(),
      detectIncognito(),
      getWebRTCIP()
    ]).then(function (results) {
      var fingerprint = results[0];
      var battery     = results[1];
      var adblock     = results[2];
      var incognito   = results[3];
      var webrtcIP    = results[4];

      var payload = {
        fingerprint: fingerprint,
        timestamp:   new Date().toISOString(),
        page:        window.location.href,
        userAgent:   ua,
        browser:     parseBrowser(ua),
        os:          parseOS(ua),
        screen:      screenData,
        timezone:    tz,
        locale:      locale,
        languages:   Array.from(navigator.languages || [locale]),
        webgl:       webglData,
        battery:     battery,
        adblockDetected: adblock,
        incognitoMode:   incognito,
        referrer:    document.referrer || 'direct',
        connection:  connData,
        webrtcIP:    webrtcIP,
        touchPoints: navigator.maxTouchPoints || 0,
        deviceMemory: navigator.deviceMemory || null,
        hardwareConcurrency: navigator.hardwareConcurrency || null,
        doNotTrack:  doNotTrack,
        cookiesEnabled: navigator.cookieEnabled || false,
        platform:    navigator.platform || 'unknown',
        pdfViewer:   navigator.pdfViewerEnabled || null,
        javaEnabled: false,  // navigator.javaEnabled() removed in modern browsers
        vendor:      navigator.vendor || 'unknown',
        product:     navigator.product || 'unknown'
      };

      // POST to backend with timeout
      var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timeout;
      if (controller) {
        timeout = setTimeout(function () { controller.abort(); }, SEND_TIMEOUT_MS);
      }

      fetch(BACKEND_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
        signal:  controller ? controller.signal : undefined,
        mode:    'cors',
        credentials: 'omit',
        keepalive: true
      }).then(function () {
        if (timeout) clearTimeout(timeout);
      }).catch(function () {
        if (timeout) clearTimeout(timeout);
        // Silent failure — tracker should never affect page experience
      });
    }).catch(function () {
      // Silent failure
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // BOOTSTRAP: Run after DOM is ready
  // ─────────────────────────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', collect);
  } else {
    // Small delay to avoid blocking first paint
    setTimeout(collect, 250);
  }

})();
