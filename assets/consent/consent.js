/*
 * The consent bar of the hosted demo at paracosm.agentos.sh, and the
 * analytics it gates.
 *
 * The server adds this script, its stylesheet and its configuration (the
 * JSON element #paracosm-consent-config) to the pages it sends in
 * hosted_demo mode (src/server/site-analytics.ts). Three purposes:
 *   count    Plausible, cookieless, on until the visitor turns it off. Page
 *            views go to this site's own POST /api/event, path only.
 *   measure  Google Analytics 4, off until the visitor turns it on.
 *   record   Microsoft Clarity, off until the visitor turns it on.
 * No vendor script loads before its purpose's yes. A privacy signal (the
 * Sec-GPC header the server saw, navigator.globalPrivacyControl or Do Not
 * Track) turns every purpose off, the count included, and shows no bar.
 *
 * The answer is kept per purpose in localStorage under
 * analytics_consent_purposes, with when it was given and a SHA-256 of the
 * words it was given to. plausible_ignore is "true" exactly when the count
 * is off, the flag Plausible's own tracker reads. Any element with
 * data-consent-open (the footers' Analytics choices) reopens the choices.
 */
(function () {
  'use strict';

  var STORE_KEY = 'analytics_consent_purposes';
  var IGNORE_KEY = 'plausible_ignore';
  var STORE_VERSION = 1;

  var configNode = document.getElementById('paracosm-consent-config');
  if (!configNode || window.__paracosmConsent) return;
  var config;
  try {
    config = JSON.parse(configNode.textContent || '{}');
  } catch (error) {
    return;
  }
  window.__paracosmConsent = true;

  var GA_ID = typeof config.ga === 'string' && /^G-[A-Z0-9]{6,16}$/.test(config.ga) ? config.ga : '';
  var CLARITY_ID = typeof config.clarity === 'string' && /^[a-z0-9]{6,16}$/.test(config.clarity) ? config.clarity : '';

  /** The purposes this site runs: the count always, the others when the build carries their id. */
  var RUNS = { count: true, measure: GA_ID !== '', record: CLARITY_ID !== '' };

  var signal = config.signal === true ||
    navigator.globalPrivacyControl === true ||
    navigator.doNotTrack === '1' ||
    window.doNotTrack === '1';

  // ---------------------------------------------------------------- words

  var VENDOR_NAMES = [];
  if (RUNS.measure) VENDOR_NAMES.push('Google Analytics');
  if (RUNS.record) VENDOR_NAMES.push('Microsoft Clarity');

  var WORDS = {
    region: 'Analytics choices',
    lead: 'Plausible counts visits to Paracosm without cookies.' +
      (VENDOR_NAMES.length ? ' ' + VENDOR_NAMES.join(' and ') + (VENDOR_NAMES.length > 1 ? ' run' : ' runs') + ' only if you turn ' + (VENDOR_NAMES.length > 1 ? 'them' : 'it') + ' on.' : '') +
      ' Change your answer at any time under Analytics choices at the bottom of the page.',
    reject: 'Reject all',
    choose: 'Choose',
    accept: 'Accept all',
    save: 'Save choices',
    close: 'Close',
    alwaysOn: 'Always on',
    signal: 'Your browser sends a privacy signal, so this site counts nothing and loads none of these tools.',
    rows: [
      { id: 'necessary', name: 'Strictly necessary', vendor: '', text: 'The dashboard’s two cookies, which keep your scenario pick and your runs with this browser.' },
      { id: 'count', name: 'Count visits', vendor: 'Plausible', text: 'Counts page views on our own server, with no cookie and no stored IP address.' },
      { id: 'measure', name: 'Measure use', vendor: 'Google Analytics', text: 'Sets cookies that tell visits apart, to show how each page is used. Google signals and ad personalization stay off.' },
      { id: 'record', name: 'Record sessions', vendor: 'Microsoft Clarity', text: 'Records clicks and scrolling as replays and heatmaps, with the page’s text and images masked.' },
    ].filter(function (row) { return row.id === 'necessary' || RUNS[row.id]; }),
  };

  /** A SHA-256 of every word the bar shows, kept with the answer; empty where the browser has no digest. */
  var wordsHash = '';
  (function hashWords() {
    var text = [WORDS.lead].concat(WORDS.rows.map(function (row) { return row.name + ' ' + row.vendor + ' ' + row.text; })).join('\n');
    try {
      if (!window.crypto || !window.crypto.subtle || typeof TextEncoder === 'undefined') return;
      window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function (digest) {
        wordsHash = Array.prototype.map.call(new Uint8Array(digest), function (byte) {
          return ('0' + byte.toString(16)).slice(-2);
        }).join('');
      }, function () {});
    } catch (error) { /* no digest: the answer is kept without one */ }
  })();

  // -------------------------------------------------------------- storage

  function readLocal(key) {
    try { return window.localStorage.getItem(key); } catch (error) { return null; }
  }

  function writeLocal(key, value) {
    try {
      if (value === null) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, value);
    } catch (error) { /* storage refused: the answer lasts this page only */ }
  }

  var pageAnswer = null;

  /** The answer this browser holds, or null when it has given none. */
  function readAnswer() {
    if (pageAnswer) return pageAnswer;
    var raw = readLocal(STORE_KEY);
    if (!raw) return null;
    try {
      var parsed = JSON.parse(raw);
      var purposes = parsed && parsed.purposes;
      if (!purposes || typeof purposes !== 'object') return null;
      return { count: purposes.count === true, measure: purposes.measure === true, record: purposes.record === true };
    } catch (error) {
      return null;
    }
  }

  /** What runs on this page: the answer, or the count alone; nothing under a privacy signal. */
  function effective() {
    if (signal) return { count: false, measure: false, record: false };
    var answer = readAnswer() || { count: true, measure: false, record: false };
    var count = answer.count && readLocal(IGNORE_KEY) !== 'true';
    return { count: count && RUNS.count, measure: answer.measure && RUNS.measure, record: answer.record && RUNS.record };
  }

  function save(choice) {
    var before = effective();
    var purposes = { count: choice.count === true, measure: choice.measure === true, record: choice.record === true };
    pageAnswer = purposes;
    writeLocal(STORE_KEY, JSON.stringify({ purposes: purposes, at: new Date().toISOString(), words: wordsHash, version: STORE_VERSION }));
    writeLocal(IGNORE_KEY, purposes.count ? null : 'true');
    if (before.measure && !purposes.measure) withdrawMeasure();
    if (before.record && !purposes.record) withdrawRecord();
    apply();
  }

  // -------------------------------------------------------------- vendors

  function inject(src) {
    var script = document.createElement('script');
    script.async = true;
    script.src = src;
    document.head.appendChild(script);
  }

  /** Removes this site's cookies whose names match, for the host and each parent domain. */
  function clearCookies(pattern) {
    var names = document.cookie.split(';').map(function (part) { return part.split('=')[0].trim(); }).filter(function (name) {
      return name && pattern.test(name);
    });
    if (!names.length) return;
    var host = location.hostname;
    // The cookie as set with no domain, then with this host's name, then
    // with each parent domain short of the top-level one (none for an address).
    var domains = ['', host];
    if (!/^[\d.]+$/.test(host) && host.indexOf(':') === -1) {
      var labels = host.split('.');
      for (var i = 1; i < labels.length - 1; i++) domains.push(labels.slice(i).join('.'));
    }
    names.forEach(function (name) {
      domains.forEach(function (domain) {
        document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/' + (domain ? '; domain=' + domain : '');
      });
    });
  }

  var loaded = { measure: false, record: false };

  function gtag() {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push(arguments);
  }

  function measurePage() {
    gtag('event', 'page_view', { page_location: location.origin + location.pathname, page_title: document.title });
  }

  function loadMeasure() {
    window['ga-disable-' + GA_ID] = false;
    if (loaded.measure) {
      gtag('consent', 'update', { analytics_storage: 'granted' });
      measurePage();
      return;
    }
    loaded.measure = true;
    window.gtag = window.gtag || gtag;
    gtag('consent', 'default', { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'granted' });
    gtag('js', new Date());
    gtag('config', GA_ID, {
      send_page_view: false,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
      cookie_domain: location.hostname,
    });
    measurePage();
    inject('https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(GA_ID));
  }

  function withdrawMeasure() {
    if (GA_ID) window['ga-disable-' + GA_ID] = true;
    if (loaded.measure) gtag('consent', 'update', { analytics_storage: 'denied' });
    clearCookies(/^(_ga($|_)|_gid$|_gat)/);
  }

  function clarity() {
    window.clarity = window.clarity || function () { (window.clarity.q = window.clarity.q || []).push(arguments); };
    window.clarity.apply(window, arguments);
  }

  function loadRecord() {
    if (loaded.record) {
      clarity('consentv2', { ad_Storage: 'denied', analytics_Storage: 'granted' });
      return;
    }
    loaded.record = true;
    if (document.body) document.body.setAttribute('data-clarity-mask', 'True');
    clarity('consentv2', { ad_Storage: 'denied', analytics_Storage: 'granted' });
    inject('https://www.clarity.ms/tag/' + encodeURIComponent(CLARITY_ID));
  }

  function withdrawRecord() {
    if (loaded.record) {
      clarity('consentv2', { ad_Storage: 'denied', analytics_Storage: 'denied' });
      clarity('consent', false);
    }
    clearCookies(/^(_clck|_clsk)$/);
  }

  var countedPath = null;

  /** Sends this page's view to the site's own count endpoint, once a path. */
  function count() {
    if (!effective().count || countedPath === location.pathname) return;
    countedPath = location.pathname;
    try {
      window.fetch('/api/event', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ n: 'pageview', u: location.pathname, r: document.referrer || '' }),
        credentials: 'same-origin',
        keepalive: true,
      }).catch(function () {});
    } catch (error) { /* no fetch: nothing is counted */ }
  }

  function apply() {
    var purposes = effective();
    if (purposes.measure) loadMeasure();
    if (purposes.record) loadRecord();
  }

  // A page of the dashboard that changes its path without a load counts as a page view too.
  var currentPath = location.pathname;
  function onRoute() {
    if (location.pathname === currentPath) return;
    currentPath = location.pathname;
    count();
    if (loaded.measure && effective().measure) measurePage();
  }
  ['pushState', 'replaceState'].forEach(function (method) {
    var original = history[method];
    if (typeof original !== 'function') return;
    history[method] = function () {
      var result = original.apply(this, arguments);
      onRoute();
      return result;
    };
  });
  window.addEventListener('popstate', onRoute);

  // ------------------------------------------------------------------ bar

  var bar = null;
  var rowsNode = null;
  var chooseKey = null;
  var opener = null;
  var switches = {};

  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function key(text, onClick) {
    var button = element('button', 'pcc-key', text);
    button.type = 'button';
    button.addEventListener('click', onClick);
    return button;
  }

  function setSwitch(button, on) {
    button.setAttribute('aria-checked', on ? 'true' : 'false');
  }

  function build() {
    bar = element('div', 'pcc');
    bar.id = 'pcc';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', WORDS.region);
    bar.hidden = true;

    var inner = element('div', 'pcc-inner');
    inner.appendChild(element('p', 'pcc-lead', WORDS.lead));

    rowsNode = element('div', 'pcc-rows');
    rowsNode.id = 'pcc-rows';
    rowsNode.hidden = true;
    WORDS.rows.forEach(function (row) {
      var line = element('div', 'pcc-row');
      var text = element('div', 'pcc-row-text');
      var name = element('span', 'pcc-name', row.name);
      name.id = 'pcc-name-' + row.id;
      if (row.vendor) {
        name.appendChild(document.createTextNode(' '));
        name.appendChild(element('span', 'pcc-vendor', row.vendor));
      }
      var detail = element('span', 'pcc-detail', row.text);
      detail.id = 'pcc-detail-' + row.id;
      text.appendChild(name);
      text.appendChild(detail);
      line.appendChild(text);
      if (row.id === 'necessary') {
        line.appendChild(element('span', 'pcc-always', WORDS.alwaysOn));
      } else {
        var toggle = element('button', 'pcc-switch');
        toggle.type = 'button';
        toggle.setAttribute('role', 'switch');
        toggle.setAttribute('aria-labelledby', name.id);
        toggle.setAttribute('aria-describedby', detail.id);
        toggle.appendChild(element('span', 'pcc-knob'));
        toggle.addEventListener('click', function () {
          if (toggle.disabled) return;
          setSwitch(toggle, toggle.getAttribute('aria-checked') !== 'true');
        });
        switches[row.id] = toggle;
        line.appendChild(toggle);
      }
      rowsNode.appendChild(line);
    });
    var signalNote = element('p', 'pcc-signal', WORDS.signal);
    signalNote.hidden = !signal;
    rowsNode.appendChild(signalNote);
    var saveKey = element('button', 'pcc-save', WORDS.save);
    saveKey.type = 'button';
    saveKey.hidden = signal;
    saveKey.addEventListener('click', function () {
      save({
        count: switches.count ? switches.count.getAttribute('aria-checked') === 'true' : false,
        measure: switches.measure ? switches.measure.getAttribute('aria-checked') === 'true' : false,
        record: switches.record ? switches.record.getAttribute('aria-checked') === 'true' : false,
      });
      close();
    });
    rowsNode.appendChild(saveKey);
    inner.appendChild(rowsNode);

    var keys = element('div', 'pcc-keys');
    if (signal) {
      keys.appendChild(key(WORDS.close, close));
    } else {
      keys.appendChild(key(WORDS.reject, function () {
        save({ count: false, measure: false, record: false });
        close();
      }));
      chooseKey = key(WORDS.choose, function () { showRows(rowsNode.hidden); });
      chooseKey.setAttribute('aria-expanded', 'false');
      chooseKey.setAttribute('aria-controls', rowsNode.id);
      keys.appendChild(chooseKey);
      keys.appendChild(key(WORDS.accept, function () {
        save({ count: true, measure: true, record: true });
        close();
      }));
    }
    inner.appendChild(keys);
    bar.appendChild(inner);
    document.body.appendChild(bar);
  }

  function syncSwitches() {
    var purposes = effective();
    Object.keys(switches).forEach(function (id) {
      setSwitch(switches[id], purposes[id]);
      switches[id].disabled = signal;
    });
  }

  function showRows(open) {
    if (open) syncSwitches();
    rowsNode.hidden = !open;
    if (chooseKey) chooseKey.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function show(withRows) {
    if (!bar) build();
    showRows(withRows);
    bar.hidden = false;
  }

  function close() {
    if (!bar) return;
    bar.hidden = true;
    showRows(false);
    if (opener && document.contains(opener)) opener.focus();
    opener = null;
  }

  function reopen(from) {
    opener = from;
    show(true);
    var first = bar.querySelector('.pcc-switch:not([disabled])') || bar.querySelector('.pcc-key');
    if (first) first.focus();
  }

  document.addEventListener('click', function (event) {
    var target = event.target;
    var control = target && target.closest ? target.closest('[data-consent-open]') : null;
    if (!control) return;
    event.preventDefault();
    if (bar && !bar.hidden && opener === control) close();
    else reopen(control);
  });

  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape' || !bar || bar.hidden) return;
    // A first answer is given with a key; Escape closes the choices once one is held.
    if (readAnswer() || signal) close();
  });

  function start() {
    var controls = document.querySelectorAll('[data-consent-open][hidden]');
    for (var i = 0; i < controls.length; i++) controls[i].hidden = false;
    count();
    apply();
    if (!signal && !readAnswer()) show(false);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
