/*
 * The consent bar of the hosted demo at paracosm.agentos.sh, and the
 * analytics it gates.
 *
 * The server adds this script, its stylesheet and its configuration (the
 * JSON element #paracosm-consent-config) to the pages it sends in
 * hosted_demo mode (src/server/site-analytics.ts). Three purposes:
 *   count    Plausible, cookieless, on until the visitor turns it off. Page
 *            views go to this site's own POST /api/event, which forwards
 *            the page's public address and no referrer.
 *   measure  Google Analytics 4, off until the visitor turns it on.
 *   record   Microsoft Clarity, off until the visitor turns it on.
 * The bar offers only the purposes whose tool this build configures. No
 * vendor script loads before its purpose's yes. A privacy signal (the
 * Sec-GPC or DNT header the server saw, navigator.globalPrivacyControl or
 * navigator.doNotTrack) turns every purpose off, the count included, and
 * shows no bar; the footers' control then explains the signal instead.
 *
 * The answer is kept per purpose in localStorage under
 * analytics_consent_purposes, with when it was given, the record's version
 * and a hash of every word the bar shows (WORDS): a SHA-256 in hex where
 * the browser has Web Crypto's digest, and an FNV-1a, written
 * "fnv1a32-<8 hex digits>", where it has none (a page that is not a secure
 * context). A stored answer counts only when it has the current version
 * and the current words' hash; any other record counts as none, so the bar
 * asks again. The hash is worked out before the bar appears, so no key can
 * save without it. When the browser refuses to store an answer, the answer
 * just given is the one this page runs, and the bar says it could not be
 * saved.
 *
 * plausible_ignore is "true" exactly when the count is off, the flag
 * Plausible's own tracker reads. It holds while no current answer is
 * stored, so an earlier Reject all keeps the count off until a new answer.
 * Any element with data-consent-open (the footers' Analytics choices)
 * reopens the choices. Turning recordings off ends Clarity on the page
 * without reloading it (withdrawRecord).
 *
 * window.paracosmConsent.allows(purpose), read-only, tells the dashboard
 * whether measure or record runs on the page now, so its own events go to
 * Google Analytics and Clarity only under their purposes' yes
 * (src/dashboard/src/analytics/forgeEvents.ts).
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
  /** What a test or a support person can read: the words the bar shows and their hash. */
  var exposed = { words: null, hash: '' };
  window.__paracosmConsent = exposed;

  var GA_ID = typeof config.ga === 'string' && /^G-[A-Z0-9]{6,16}$/.test(config.ga) ? config.ga : '';
  var CLARITY_ID = typeof config.clarity === 'string' && /^[a-z0-9]{6,16}$/.test(config.clarity) ? config.clarity : '';

  /** The purposes this page offers: the count always, the others when the build carries their id. */
  var RUNS = { count: true, measure: GA_ID !== '', record: CLARITY_ID !== '' };
  var PURPOSES = ['count', 'measure', 'record'];

  var signal = config.signal === true ||
    navigator.globalPrivacyControl === true ||
    navigator.doNotTrack === '1' ||
    window.doNotTrack === '1';

  // ---------------------------------------------------------------- words

  var VENDOR_NAMES = [];
  if (RUNS.measure) VENDOR_NAMES.push('Google Analytics');
  if (RUNS.record) VENDOR_NAMES.push('Microsoft Clarity');

  /** Every word the bar shows, and nothing else: their hash is kept with the answer. */
  var WORDS = {
    region: 'Analytics choices',
    choices: 'Choose what runs',
    lead: 'Plausible counts visits to Paracosm without cookies.' +
      (VENDOR_NAMES.length ? ' ' + VENDOR_NAMES.join(' and ') + (VENDOR_NAMES.length > 1 ? ' run' : ' runs') + ' only if you turn ' + (VENDOR_NAMES.length > 1 ? 'them' : 'it') + ' on.' : '') +
      ' Change your answer at any time under Analytics choices at the bottom of the page.',
    privacy: 'How each tool works',
    reject: 'Reject all',
    choose: 'Choose',
    accept: 'Accept all',
    save: 'Save choices',
    close: 'Close',
    alwaysOn: 'Always on',
    signalTitle: 'Privacy signal',
    signal: 'Your browser asks sites not to track you, so nothing optional runs on this site: no visit count and no analytics tools.',
    notSaved: 'Your choice could not be saved on this device, so it holds only until you leave this page.',
    rows: [
      { id: 'necessary', name: 'Strictly necessary', vendor: '', text: 'The dashboard’s two cookies, which keep your scenario pick and your runs with this browser.' },
      { id: 'count', name: 'Count visits', vendor: 'Plausible', text: 'Counts page views with no cookie. Our server holds your IP address in memory for one minute to limit repeated counts. Plausible receives your browser’s full User-Agent and your IP address, uses them for a daily visitor identifier, your browser and device and an approximate location, and stores neither.' },
      { id: 'measure', name: 'Measure use', vendor: 'Google Analytics', text: 'Sets cookies that tell visits apart, to show how each page is used. Google signals and ad personalization stay off.' },
      { id: 'record', name: 'Record sessions', vendor: 'Microsoft Clarity', text: 'Records clicks and scrolling as replays and heatmaps, with the page’s text and images masked.' },
    ].filter(function (row) { return row.id === 'necessary' || RUNS[row.id]; }),
  };
  exposed.words = WORDS;

  /** The hash of WORDS kept with an answer; set before the bar starts. */
  var wordsHash = '';

  /** FNV-1a, for a browser with no SHA-256 digest (a page that is not a secure context). */
  function fnv(text) {
    var hash = 0x811c9dc5;
    for (var i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return 'fnv1a32-' + ('0000000' + hash.toString(16)).slice(-8);
  }

  /** A SHA-256 of WORDS as JSON, in hex; FNV-1a where the browser has no digest. */
  function digestWords() {
    var text = JSON.stringify(WORDS);
    try {
      if (window.crypto && window.crypto.subtle && typeof TextEncoder !== 'undefined') {
        return window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function (digest) {
          return Array.prototype.map.call(new Uint8Array(digest), function (byte) {
            return ('0' + byte.toString(16)).slice(-2);
          }).join('');
        }, function () { return fnv(text); });
      }
    } catch (error) { /* no digest: FNV-1a below */ }
    return Promise.resolve(fnv(text));
  }

  // -------------------------------------------------------------- storage

  function readLocal(key) {
    try { return window.localStorage.getItem(key); } catch (error) { return null; }
  }

  /** Writes or removes a value; false when the browser refuses. */
  function writeLocal(key, value) {
    try {
      if (value === null) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, value);
      return true;
    } catch (error) {
      return false;
    }
  }

  /** The answer given on this page, and whether it wins over storage because storing it failed. */
  var pageAnswer = null;
  var pageWins = false;

  /**
   * A stored record as an answer, or null when it is not a record of the
   * current version given to the current words, with a yes or no for every
   * purpose this page offers. A purpose the page does not offer is off.
   */
  function parseRecord(raw) {
    if (!raw || !wordsHash) return null;
    var record;
    try { record = JSON.parse(raw); } catch (error) { return null; }
    if (!record || typeof record !== 'object' || record.version !== STORE_VERSION || record.words !== wordsHash) return null;
    var purposes = record.purposes;
    if (!purposes || typeof purposes !== 'object') return null;
    var answer = {};
    for (var i = 0; i < PURPOSES.length; i++) {
      var id = PURPOSES[i];
      if (RUNS[id] && typeof purposes[id] !== 'boolean') return null;
      answer[id] = RUNS[id] && purposes[id] === true;
    }
    return answer;
  }

  /**
   * The answer this browser holds, or null when it has given none. Storage
   * comes first, so an answer another tab saved later wins over this
   * page's, unless this page's answer could not be stored.
   */
  function readAnswer() {
    if (pageWins) return pageAnswer;
    return parseRecord(readLocal(STORE_KEY));
  }

  /** What runs on this page: the answer, or the count alone; nothing under a privacy signal. */
  function effective() {
    if (signal) return { count: false, measure: false, record: false };
    var answer = readAnswer();
    // No current answer: the count runs, unless an earlier answer turned it off on this device.
    if (!answer) return { count: RUNS.count && readLocal(IGNORE_KEY) !== 'true', measure: false, record: false };
    var count = answer.count && (pageWins || readLocal(IGNORE_KEY) !== 'true');
    return { count: count && RUNS.count, measure: answer.measure && RUNS.measure, record: answer.record && RUNS.record };
  }

  /** Saves an answer for the purposes this page offers and applies it; false when the browser refused to store it. */
  function save(choice) {
    var purposes = {
      count: RUNS.count && choice.count === true,
      measure: RUNS.measure && choice.measure === true,
      record: RUNS.record && choice.record === true,
    };
    var record = JSON.stringify({ purposes: purposes, at: new Date().toISOString(), words: wordsHash, version: STORE_VERSION });
    var saved = writeLocal(STORE_KEY, record) && readLocal(STORE_KEY) === record;
    // The earlier no to the count is part of the answer: when it cannot be
    // cleared or set, this page's answer wins and the bar says it was not saved.
    var ignoreSaved = writeLocal(IGNORE_KEY, purposes.count ? null : 'true') && readLocal(IGNORE_KEY) === (purposes.count ? null : 'true');
    saved = saved && ignoreSaved;
    pageAnswer = purposes;
    pageWins = !saved;
    if (active.measure && !purposes.measure) withdrawMeasure();
    if (loaded.record && !purposes.record) withdrawRecord();
    apply();
    return saved;
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

  /** Whether each tool's script was added to this page, and whether it runs now. */
  var loaded = { measure: false, record: false };
  var active = { measure: false, record: false };

  /*
   * What the dashboard reads before it sends an event of its own: whether a
   * purpose is allowed on this page now. Measure and record also depend on
   * whether their vendors are active. Count follows the effective choice
   * after the bar has read and validated the saved answer.
   * Other code on the page can neither replace it nor change its answer.
   */
  try {
    Object.defineProperty(window, 'paracosmConsent', {
      value: Object.freeze({
        get ready() { return ready; },
        allows: function (purpose) {
          if (!ready) return false;
          var purposes = effective();
          if (purpose === 'count') return purposes.count;
          if (purpose === 'measure' || purpose === 'record') return purposes[purpose] && active[purpose];
          return false;
        },
      }),
      configurable: false,
      enumerable: false,
      writable: false,
    });
  } catch (error) { /* already defined: the page keeps the first */ }

  function gtag() {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push(arguments);
  }

  function measurePage() {
    gtag('event', 'page_view', { page_location: location.origin + location.pathname, page_title: document.title });
  }

  function loadMeasure() {
    active.measure = true;
    // Google's opt-out flag: while it is true the tag sends nothing
    // (https://developers.google.com/analytics/devguides/collection/ga4/disable-analytics).
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
    active.measure = false;
    // The same flag set: the tag already on this page sends no more hits.
    if (GA_ID) window['ga-disable-' + GA_ID] = true;
    if (loaded.measure) gtag('consent', 'update', { analytics_storage: 'denied' });
    clearCookies(/^(_ga($|_)|_gid$|_gat)/);
  }

  function clarity() {
    window.clarity = window.clarity || function () { (window.clarity.q = window.clarity.q || []).push(arguments); };
    window.clarity.apply(window, arguments);
  }

  function loadRecord() {
    active.record = true;
    loaded.record = true;
    if (document.body) document.body.setAttribute('data-clarity-mask', 'True');
    clarity('consentv2', { ad_Storage: 'denied', analytics_Storage: 'granted' });
    inject('https://www.clarity.ms/tag/' + encodeURIComponent(CLARITY_ID));
  }

  /** Whether this page refuses every request to Clarity's hosts. */
  var clarityBlocked = false;

  function toClarity(url) {
    try {
      return /(^|\.)clarity\.ms$/i.test(new URL(String(url), location.href).hostname);
    } catch (error) {
      return false;
    }
  }

  /**
   * From now on this page sends nothing to Clarity's hosts: fetch rejects,
   * sendBeacon answers false and an XMLHttpRequest is never sent, the ways
   * clarity-js uploads (src/data/upload.ts) and reports (src/core/report.ts).
   * Other requests pass as they were.
   */
  function blockClarity() {
    if (clarityBlocked) return;
    clarityBlocked = true;
    var fetchFirst = window.fetch;
    if (typeof fetchFirst === 'function') {
      window.fetch = function (input) {
        var url = input && typeof input === 'object' && 'url' in input ? input.url : input;
        if (toClarity(url)) return Promise.reject(new TypeError('Recordings are off on this page.'));
        return fetchFirst.apply(window, arguments);
      };
    }
    if (typeof navigator.sendBeacon === 'function') {
      var beaconFirst = navigator.sendBeacon;
      navigator.sendBeacon = function (url) {
        if (toClarity(url)) return false;
        return beaconFirst.apply(navigator, arguments);
      };
    }
    if (typeof XMLHttpRequest === 'function') {
      var openFirst = XMLHttpRequest.prototype.open;
      var sendFirst = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function (method, url) {
        this.__pccToClarity = toClarity(url);
        return openFirst.apply(this, arguments);
      };
      XMLHttpRequest.prototype.send = function () {
        if (this.__pccToClarity) return;
        return sendFirst.apply(this, arguments);
      };
    }
  }

  /**
   * Ends Clarity on this page, at once and for the rest of it, without a
   * reload, so nothing typed on the page is lost:
   * - the page first refuses every request to Clarity's hosts
   *   (blockClarity). Clarity's stop call ends a running recording but
   *   sends one last upload as it does (clarity-js src/clarity.ts, stop;
   *   src/data/upload.ts, stop), and that upload is refused with the rest;
   * - then the stop call, queued and dropped when the tag has not run yet;
   * - then window.clarity becomes a function that does nothing, with the
   *   "v" mark clarity-js reads as a Clarity already running, so a tag that
   *   arrives later never starts (src/queue.ts, process).
   * Clarity's consent calls are not used: denying analytics storage stops
   * it and starts it again without cookies (src/data/metadata.ts,
   * consentv2). A later yes starts recordings from the next page.
   */
  function withdrawRecord() {
    active.record = false;
    blockClarity();
    if (loaded.record && typeof window.clarity === 'function') {
      try { window.clarity('stop'); } catch (error) { /* it ends below either way */ }
    }
    var off = function () {};
    off.v = 'off';
    off.t = true;
    window.clarity = off;
    clearCookies(/^(_clck|_clsk)$/);
  }

  var ready = false;
  var countedPath = null;

  /** Sends this page's view to the site's own count endpoint, once a path. */
  function count() {
    if (!ready || !effective().count || countedPath === location.pathname) return;
    countedPath = location.pathname;
    try {
      window.fetch('/api/event', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ n: 'pageview', u: location.pathname }),
        credentials: 'same-origin',
        keepalive: true,
      }).catch(function () {});
    } catch (error) { /* no fetch: nothing is counted */ }
  }

  /** Starts what the answer turns on: this page's count, Google Analytics, Clarity. */
  function apply() {
    count();
    var purposes = effective();
    if (purposes.measure && !active.measure) loadMeasure();
    if (purposes.record && !active.record && !loaded.record) loadRecord();
  }

  // A page of the dashboard that changes its path without a load counts as a page view too.
  var currentPath = location.pathname;
  function onRoute() {
    if (location.pathname === currentPath) return;
    currentPath = location.pathname;
    count();
    if (active.measure) measurePage();
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
  var noteNode = null;
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

  /** After a key saves: the bar closes, or, when the answer could not be stored, stays and says so. */
  function answered(saved) {
    if (saved) {
      noteNode.hidden = true;
      close();
      return;
    }
    noteNode.hidden = false;
    showRows(false);
    bar.hidden = false;
  }

  /*
   * The bar's order on the page is its order on screen: the choices (when
   * open) on top, then the words, then the three keys.
   */
  function build() {
    bar = element('div', 'pcc');
    bar.id = 'pcc';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', WORDS.region);
    bar.hidden = true;

    var inner = element('div', 'pcc-inner');

    rowsNode = element('div', 'pcc-rows');
    rowsNode.id = 'pcc-rows';
    rowsNode.setAttribute('role', 'region');
    rowsNode.setAttribute('aria-label', WORDS.choices);
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
    var saveKey = element('button', 'pcc-save', WORDS.save);
    saveKey.type = 'button';
    saveKey.addEventListener('click', function () {
      answered(save({
        count: switches.count ? switches.count.getAttribute('aria-checked') === 'true' : false,
        measure: switches.measure ? switches.measure.getAttribute('aria-checked') === 'true' : false,
        record: switches.record ? switches.record.getAttribute('aria-checked') === 'true' : false,
      }));
    });
    rowsNode.appendChild(saveKey);
    inner.appendChild(rowsNode);

    var words = element('div', 'pcc-words');
    var lead = element('p', 'pcc-lead', WORDS.lead);
    lead.appendChild(document.createTextNode(' '));
    var privacy = element('a', 'pcc-link', WORDS.privacy);
    privacy.href = '/#privacy';
    lead.appendChild(privacy);
    words.appendChild(lead);
    noteNode = element('p', 'pcc-note', WORDS.notSaved);
    noteNode.setAttribute('role', 'status');
    noteNode.hidden = true;
    words.appendChild(noteNode);
    inner.appendChild(words);

    var keys = element('div', 'pcc-keys');
    keys.appendChild(key(WORDS.reject, function () {
      answered(save({ count: false, measure: false, record: false }));
    }));
    chooseKey = key(WORDS.choose, function () {
      var open = rowsNode.hidden;
      showRows(open);
      if (open) focusChoices();
    });
    chooseKey.setAttribute('aria-expanded', 'false');
    chooseKey.setAttribute('aria-controls', rowsNode.id);
    keys.appendChild(chooseKey);
    keys.appendChild(key(WORDS.accept, function () {
      answered(save({ count: true, measure: true, record: true }));
    }));
    inner.appendChild(keys);
    bar.appendChild(inner);
    document.body.appendChild(bar);
  }

  function syncSwitches() {
    var purposes = effective();
    Object.keys(switches).forEach(function (id) {
      setSwitch(switches[id], purposes[id]);
    });
  }

  function showRows(open) {
    if (open) syncSwitches();
    rowsNode.hidden = !open;
    if (chooseKey) chooseKey.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  /** Moves focus to the first switch of the open choices; the bar scrolls it into view. */
  function focusChoices() {
    var first = rowsNode.querySelector('.pcc-switch') || bar.querySelector('.pcc-key');
    if (first) first.focus();
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
    focusChoices();
  }

  // Under a privacy signal the footers' control explains it: a short note
  // with one key, never the bar, since nothing optional can run.
  var signalNode = null;

  function showSignal(from) {
    if (!signalNode) {
      signalNode = element('div', 'pcc pcc-signal-note');
      signalNode.id = 'pcc-signal';
      signalNode.setAttribute('role', 'dialog');
      signalNode.setAttribute('aria-label', WORDS.signalTitle);
      var inner = element('div', 'pcc-inner');
      var words = element('div', 'pcc-words');
      words.appendChild(element('p', 'pcc-lead', WORDS.signal));
      inner.appendChild(words);
      var keys = element('div', 'pcc-keys');
      keys.appendChild(key(WORDS.close, closeSignal));
      inner.appendChild(keys);
      signalNode.appendChild(inner);
      document.body.appendChild(signalNode);
    }
    opener = from;
    signalNode.hidden = false;
    signalNode.querySelector('.pcc-key').focus();
  }

  function closeSignal() {
    if (!signalNode || signalNode.hidden) return;
    signalNode.hidden = true;
    if (opener && document.contains(opener)) opener.focus();
    opener = null;
  }

  document.addEventListener('click', function (event) {
    var target = event.target;
    var control = target && target.closest ? target.closest('[data-consent-open]') : null;
    if (!control || !ready) return;
    event.preventDefault();
    if (signal) {
      if (signalNode && !signalNode.hidden && opener === control) closeSignal();
      else showSignal(control);
      return;
    }
    if (bar && !bar.hidden && opener === control) close();
    else reopen(control);
  });

  // Another tab of this browser saved an answer: this page follows it at
  // once, stopping what it turned off and loading what it turned on.
  window.addEventListener('storage', function (event) {
    if (!ready || (event.key !== STORE_KEY && event.key !== IGNORE_KEY && event.key !== null)) return;
    if (event.key !== IGNORE_KEY) {
      pageWins = false;
      pageAnswer = null;
    }
    var purposes = effective();
    if (active.measure && !purposes.measure) withdrawMeasure();
    if (loaded.record && !purposes.record) withdrawRecord();
    apply();
    if (bar && !bar.hidden && readAnswer() && !rowsNode.hidden) syncSwitches();
    else if (bar && !bar.hidden && readAnswer() && !opener) close();
  });

  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape') return;
    if (signalNode && !signalNode.hidden) {
      closeSignal();
      return;
    }
    if (!bar || bar.hidden) return;
    if (readAnswer()) {
      close();
      return;
    }
    // No answer yet: Escape folds the choices back to the first layer, whose keys give one.
    if (!rowsNode.hidden) {
      showRows(false);
      if (chooseKey) chooseKey.focus();
    }
  });

  function start() {
    if (ready) return;
    ready = true;
    var controls = document.querySelectorAll('[data-consent-open][hidden]');
    for (var i = 0; i < controls.length; i++) controls[i].hidden = false;
    apply();
    if (!signal && !readAnswer()) show(false);
    window.dispatchEvent(new Event('paracosm:consent-ready'));
  }

  digestWords().then(function (hash) {
    wordsHash = hash;
    exposed.hash = hash;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
  });
})();
