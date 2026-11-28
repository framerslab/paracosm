/**
 * The landing page's first screen: the look switch, the install line's copy
 * key, the landing page's count events, and the replay of one saved pair run.
 *
 * The replay draws both timelines of the run from the digest the dashboard's
 * build writes (src/dashboard/src/landing/replayDigest.ts), which the server
 * sends at GET /landing-replay.json. It asks no model and no other site for
 * anything. Frame 0 is turn 0, the people both colonies start with; frames 1
 * to N are the run's turns, each leader's colony side by side with the turn's
 * event, the leader's decision, its outcome and the tools the departments
 * forged; the last frame is the verdict. It plays once by itself when it
 * comes into view and stops at the verdict; under reduced motion it rests on
 * the verdict until a press.
 *
 * Each event follows the fixed contract of src/analytics/first-screen-events.ts
 * and goes through the site's count route as the landing page's, under the
 * visitor's answer for each purpose (assets/consent/consent.js). A copy run
 * from the package or a clone loads no consent bar, so it sends nothing.
 */
(function () {
  'use strict';

  var doc = document;
  var root = doc.documentElement;

  // ---------------------------------------------------------------- events

  function allows(purpose) {
    try {
      var consent = window.paracosmConsent;
      return !!(consent && typeof consent.allows === 'function' && consent.allows(purpose) === true);
    } catch (error) {
      return false;
    }
  }

  /** Sends one landing event: the count, then Google Analytics, then Clarity when the event is marked. */
  function send(name, fields, record) {
    if (allows('count')) {
      try {
        window.fetch('/api/event', {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          keepalive: true,
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
          body: JSON.stringify({ n: name, u: '/', p: fields }),
        }).catch(function () {});
      } catch (error) { /* the count is optional */ }
    }
    if (allows('measure') && typeof window.gtag === 'function') {
      try {
        var params = {};
        for (var key in fields) params[key] = fields[key];
        params.page_location = location.origin + '/';
        params.page_referrer = '';
        window.gtag('event', name, params);
      } catch (error) { /* a vendor failure leaves the page working */ }
    }
    if (record && allows('record') && typeof window.clarity === 'function') {
      try { window.clarity('event', name); } catch (error) { /* recording is optional */ }
    }
  }

  doc.addEventListener('click', function (event) {
    var link = event.target && event.target.closest ? event.target.closest('a[data-lp-demo]') : null;
    if (link) send('lp_demo_open', { from: link.getAttribute('data-lp-demo'), state: 'unknown' }, true);
  });

  // ----------------------------------------------------------- skip link

  var skip = doc.querySelector('.lp-skip');
  var title = doc.getElementById('lp-title');
  if (skip && title) {
    skip.addEventListener('click', function (event) {
      event.preventDefault();
      title.focus();
      title.scrollIntoView({ block: 'start' });
    });
  }

  // --------------------------------------------------------- look switch

  var lookKey = doc.getElementById('theme-toggle');
  var lookNote = doc.querySelector('.lp-look-note');
  var lookNoteTimer = 0;

  function showLook(look) {
    root.classList.toggle('light', look === 'light');
    root.style.colorScheme = look;
    var meta = doc.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', look === 'light' ? '#f0e6d2' : '#0a0806');
    if (lookKey) {
      lookKey.textContent = look === 'dark' ? '☀' : '☽';
      lookKey.setAttribute('aria-label', look === 'dark' ? 'Switch to the light look' : 'Switch to the dark look');
    }
  }

  showLook(root.classList.contains('light') ? 'light' : 'dark');
  if (lookKey) {
    lookKey.addEventListener('click', function () {
      var next = root.classList.contains('light') ? 'dark' : 'light';
      showLook(next);
      var kept = true;
      try { localStorage.setItem('paracosm-theme', next); } catch (error) { kept = false; }
      if (!kept && lookNote) {
        lookNote.textContent = 'This browser did not keep the look. It holds until you leave this page.';
        clearTimeout(lookNoteTimer);
        lookNoteTimer = setTimeout(function () { lookNote.textContent = ''; }, 4000);
      }
      send('lp_look', { to: next }, false);
    });
  }

  // -------------------------------------------------------- install line

  var copyKey = doc.querySelector('.lp-copy');
  var copyStatus = doc.querySelector('.lp-copy-status');
  if (copyKey && copyStatus) {
    copyKey.hidden = false;
    var copyPress = 0;
    var copyTimer = 0;
    copyKey.addEventListener('click', function () {
      var press = ++copyPress;
      clearTimeout(copyTimer);
      copyKey.textContent = 'Copy';
      copyKey.classList.remove('lp-copied');
      copyStatus.textContent = '';
      copyStatus.classList.remove('lp-refused');
      var done = function () {
        if (press !== copyPress) return;
        copyKey.textContent = 'Copied';
        copyKey.classList.add('lp-copied');
        copyStatus.textContent = 'The line was copied.';
        send('lp_copy', { what: 'install', result: 'copied' }, true);
        copyTimer = setTimeout(function () {
          copyKey.textContent = 'Copy';
          copyKey.classList.remove('lp-copied');
          copyStatus.textContent = '';
        }, 2000);
      };
      var refused = function () {
        if (press !== copyPress) return;
        copyStatus.textContent = 'The browser did not copy the line. Select it and copy it.';
        copyStatus.classList.add('lp-refused');
        send('lp_copy', { what: 'install', result: 'refused' }, true);
      };
      var clipboard = navigator.clipboard;
      if (!clipboard || typeof clipboard.writeText !== 'function') return refused();
      var write;
      try { write = clipboard.writeText('npm install paracosm'); } catch (error) { return refused(); }
      write.then(done, refused);
    });
  }

  // -------------------------------------------------------------- replay

  var frame = doc.getElementById('lp-replay');
  if (!frame) return;

  var stage = frame.querySelector('.lp-stage');
  var figuresLine = frame.querySelector('.lp-replay-figures');
  var statusFigures = frame.querySelector('.lp-status-figures');
  var verdictLine = frame.querySelector('.lp-verdict');
  var controls = frame.querySelector('.lp-controls');
  var playKey = frame.querySelector('.lp-play');
  var range = frame.querySelector('.lp-range');
  var ticks = frame.querySelector('.lp-ticks');
  var previousKey = frame.querySelector('.lp-prev');
  var nextKey = frame.querySelector('.lp-next');
  var spoken = frame.querySelector('.lp-sr');
  var problem = frame.querySelector('.lp-replay-problem');

  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var motion = reduced ? 'reduced' : 'full';
  /** About 20 s for the run's eight frames. */
  var FRAME_MS = 2500;
  var OUTCOMES = {
    risky_success: 'RISKY WIN',
    risky_failure: 'RISKY LOSS',
    conservative_success: 'SAFE WIN',
    conservative_failure: 'SAFE LOSS',
  };

  var run = null;
  var at = 0;
  var timer = 0;
  var playing = false;
  var started = false;

  function el(tag, className, text) {
    var node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function last() { return run.turns + 1; }

  /** A department's mark in the grid: its first three letters, as the dashboard abbreviates them. */
  function departmentMark(name) {
    return String(name).slice(0, 3).toUpperCase();
  }

  /** The grid of one colony: one row a department, one cell a person. */
  function grid(people, side, label) {
    var box = el('div', 'lp-grid');
    box.setAttribute('role', 'img');
    box.setAttribute('aria-label', label);
    var byDepartment = {};
    people.forEach(function (person) {
      (byDepartment[person[1]] = byDepartment[person[1]] || []).push(person);
    });
    run.departments.forEach(function (department, index) {
      var row = byDepartment[index];
      if (!row) return;
      var line = el('div', 'lp-grid-row');
      line.appendChild(el('span', 'lp-dept', departmentMark(department)));
      var cells = el('span', 'lp-cells');
      row.forEach(function (person) {
        var cell = el('span', 'lp-cell lp-cell-' + side);
        cell.setAttribute('data-alive', String(person[2]));
        if (person[3] === 1) cell.setAttribute('data-named', '1');
        cells.appendChild(cell);
      });
      line.appendChild(cells);
      box.appendChild(line);
    });
    return box;
  }

  function aliveOf(people) {
    var count = 0;
    for (var i = 0; i < people.length; i++) if (people[i][2] === 1) count++;
    return count;
  }

  function money(usd) { return '$' + usd.toFixed(2); }
  function thousands(tokens) { return Math.round(tokens / 1000).toLocaleString('en-US') + 'k tokens'; }

  function drawStart() {
    var start = run.start;
    var box = el('div', 'lp-start');
    var named = start.people.filter(function (person) { return person[3] === 1; });
    box.appendChild(el('p', 'lp-start-line',
      'Both colonies start with the same ' + start.people.length + ' people, these ' + named.length +
      ' among them. Each leader’s decisions make them diverge.'));
    box.lastChild.setAttribute('data-text', 'body');
    box.appendChild(grid(start.people, 'start', 'Turn 0: the ' + start.people.length + ' people both colonies start with'));
    var list = el('ul', 'lp-named');
    named.forEach(function (person) {
      var item = el('li');
      item.appendChild(el('span', 'lp-named-name', run.names[person[0]]));
      item.appendChild(el('span', 'lp-named-dept', departmentMark(run.departments[person[1]])));
      list.appendChild(item);
    });
    box.appendChild(list);
    return box;
  }

  function drawSide(index, side, turn) {
    var leader = run.leaders[index];
    var card = el('article', 'lp-side lp-side-' + (index === 0 ? 'a' : 'b'));
    var name = el('p', 'lp-name');
    name.setAttribute('data-text', 'body');
    var swatch = el('span', 'lp-swatch');
    swatch.setAttribute('aria-hidden', 'true');
    name.appendChild(swatch);
    name.appendChild(doc.createTextNode((index + 1) + ' ' + leader.name + ', ' + leader.archetype));
    card.appendChild(name);

    var body = el('div', 'lp-side-body');
    var left = el('div', 'lp-side-grid');
    var aliveNow = aliveOf(side.people);
    left.appendChild(grid(side.people, index === 0 ? 'a' : 'b',
      'Turn ' + turn + ': ' + leader.name + '’s colony, ' + aliveNow + ' people alive'));
    var born = side.people.length - run.start.people.length;
    var died = side.people.length - aliveNow;
    left.appendChild(el('p', 'lp-figures', aliveNow + ' alive · ' + born + ' born · ' + died + ' died · morale ' + Math.round(side.morale * 100) + '%'));
    body.appendChild(left);

    var log = el('div', 'lp-side-log');
    log.appendChild(el('p', 'lp-tag', 'T' + turn + ' · ' + (side.emergent ? 'EVENT DIRECTOR' : 'SCENARIO')));
    log.appendChild(el('p', 'lp-event', side.event));
    var decision = el('p', 'lp-decision', side.decision);
    decision.setAttribute('data-text', 'body');
    log.appendChild(decision);
    var mark = el('p', 'lp-outcome-row');
    mark.appendChild(el('span', 'lp-outcome', OUTCOMES[side.outcome] || ''));
    log.appendChild(mark);
    if (side.tools.length) {
      var tools = el('ul', 'lp-tools');
      tools.setAttribute('aria-label', 'Tools the departments forged');
      side.tools.forEach(function (tool) {
        var item = el('li', 'lp-tool');
        item.appendChild(el('span', 'lp-tool-name', tool.name));
        item.appendChild(el('span', 'lp-tool-dept', departmentMark(tool.department)));
        var verdict = el('span', 'lp-tool-judge ' + (tool.passed ? 'lp-pass' : 'lp-fail'));
        var glyph = el('span', 'lp-judge-glyph');
        glyph.setAttribute('aria-hidden', 'true');
        verdict.appendChild(glyph);
        verdict.appendChild(doc.createTextNode((tool.passed ? 'PASS ' : 'FAIL ') + tool.score.toFixed(2)));
        item.appendChild(verdict);
        tools.appendChild(item);
      });
      log.appendChild(tools);
    }
    body.appendChild(log);
    card.appendChild(body);
    return card;
  }

  /** The words a screen reader hears for a frame when a press changes it. */
  function said(index) {
    if (index === 0) return 'Turn 0. Both colonies start with the same ' + run.start.people.length + ' people.';
    var turn = Math.min(index, run.turns);
    var sides = run.frames[turn - 1].sides;
    var words = (index === last() ? 'Verdict. ' + verdictWords() + ' ' : 'Turn ' + turn + '. ');
    if (index !== last()) {
      for (var i = 0; i < 2; i++) {
        words += run.leaders[i].name + ': ' + sides[i].decision + ' ' + (OUTCOMES[sides[i].outcome] || '') + '. ';
      }
    }
    return words.trim();
  }

  function verdictWords() {
    var winner = run.verdict.winner;
    var w = run.leaders[0].name === winner ? 0 : 1;
    var other = 1 - w;
    var words = 'Verdict: ' + winner + '. ' + winner + '’s colony ends with ' + run.verdict.population[w] +
      ' people and ' + run.leaders[other].name + '’s with ' + run.verdict.population[other] + '. ' +
      'Where they split: turn ' + run.verdict.splitTurn + '.';
    if (run.verdict.eventSplitTurn && run.verdict.eventSplitTurn !== run.verdict.splitTurn) {
      words += ' Their event directors write different crises from turn ' + run.verdict.eventSplitTurn + '.';
    }
    return words;
  }

  function draw(index, announce) {
    at = Math.max(0, Math.min(last(), index));
    var turn = Math.min(at, run.turns);
    stage.replaceChildren();
    if (at === 0) {
      stage.appendChild(drawStart());
    } else {
      var sides = el('div', 'lp-sides');
      var current = run.frames[turn - 1];
      sides.appendChild(drawSide(0, current.sides[0], turn));
      sides.appendChild(drawSide(1, current.sides[1], turn));
      stage.appendChild(sides);
    }
    var atVerdict = at === last();
    verdictLine.hidden = !atVerdict;
    verdictLine.textContent = atVerdict ? verdictWords() : '';

    var year = at === 0 ? run.start.year : run.frames[turn - 1].year;
    var cost = at === 0 ? { usd: 0, tokens: 0 } : run.frames[turn - 1].cost;
    statusFigures.textContent = (atVerdict ? 'VERDICT' : 'T' + at) + ' · Y' + year + ' · ' + money(cost.usd) + ' · ' + thousands(cost.tokens);

    range.value = String(at);
    range.setAttribute('aria-valuetext', atVerdict ? 'Verdict' : 'Turn ' + at + ' of ' + run.turns);
    previousKey.disabled = at === 0;
    nextKey.disabled = atVerdict;
    previousKey.setAttribute('aria-label', at === 0 ? 'Previous turn, unavailable at turn 0' : 'Previous turn');
    nextKey.setAttribute('aria-label', atVerdict ? 'Next turn, unavailable at the verdict' : 'Next turn');
    var items = ticks.children;
    for (var i = 0; i < items.length; i++) items[i].classList.toggle('lp-passed', i <= at);
    if (announce) spoken.textContent = said(at);
  }

  function setPlaying(on) {
    playing = on;
    frame.setAttribute('data-playing', on ? 'true' : 'false');
    clearTimeout(timer);
    if (on) {
      playKey.textContent = 'Pause';
      timer = setTimeout(tick, FRAME_MS);
    } else {
      playKey.textContent = at === last() && started ? 'Play again' : 'Play';
    }
  }

  function tick() {
    if (!playing) return;
    draw(at + 1, false);
    if (at >= last()) {
      setPlaying(false);
      send('lp_replay', { action: 'end', motion: motion }, true);
      return;
    }
    timer = setTimeout(tick, FRAME_MS);
  }

  function step(to) {
    if (playing) setPlaying(false);
    draw(to, true);
    playKey.textContent = at === last() && started ? 'Play again' : 'Play';
    send('lp_replay', { action: 'step', motion: motion }, true);
  }

  function setup(digest) {
    run = digest;
    figuresLine.textContent = run.scenario + ' · 2 leaders · ' + run.turns + ' turns · seed ' + run.seed;
    range.max = String(last());
    ticks.replaceChildren();
    for (var i = 0; i <= last(); i++) ticks.appendChild(el('li', '', i === last() ? 'VERDICT' : 'T' + i));
    controls.hidden = false;
    problem.hidden = true;
    frame.setAttribute('data-state', 'ready');

    playKey.addEventListener('click', function () {
      if (playing) {
        setPlaying(false);
        send('lp_replay', { action: 'pause', motion: motion }, true);
        return;
      }
      var again = at === last();
      if (again) draw(0, false);
      started = true;
      setPlaying(true);
      send('lp_replay', { action: again ? 'again' : 'play', motion: motion }, true);
    });
    previousKey.addEventListener('click', function () { step(at - 1); });
    nextKey.addEventListener('click', function () { step(at + 1); });
    range.addEventListener('input', function () {
      if (playing) setPlaying(false);
      draw(Number(range.value), true);
      playKey.textContent = at === last() && started ? 'Play again' : 'Play';
    });
    range.addEventListener('change', function () {
      send('lp_replay', { action: 'step', motion: motion }, true);
    });

    if (reduced) {
      draw(last(), false);
      setPlaying(false);
      return;
    }
    draw(0, false);
    setPlaying(false);
    var begin = function () {
      if (started) return;
      started = true;
      setPlaying(true);
      send('lp_replay', { action: 'auto_start', motion: motion }, true);
    };
    if (typeof IntersectionObserver === 'function') {
      var watch = new IntersectionObserver(function (entries) {
        for (var i = 0; i < entries.length; i++) {
          if (entries[i].isIntersecting) {
            watch.disconnect();
            begin();
            return;
          }
        }
      }, { threshold: 0.25 });
      watch.observe(frame);
    } else {
      begin();
    }
  }

  function showProblem(kind) {
    frame.setAttribute('data-state', kind);
    controls.hidden = true;
    problem.replaceChildren();
    problem.hidden = false;
    var line = el('p', 'lp-problem-line');
    var mark = el('span', 'lp-broken');
    mark.setAttribute('aria-hidden', 'true');
    line.appendChild(mark);
    var demo = el('a', 'lp-problem-link', kind === 'empty' ? 'Start a run of your own in the demo' : 'Open the demo');
    demo.href = '/sim';
    if (kind === 'empty') {
      line.appendChild(doc.createTextNode('This copy ships without the saved run. '));
      line.appendChild(demo);
      line.appendChild(doc.createTextNode('.'));
      problem.appendChild(line);
      return;
    }
    line.appendChild(doc.createTextNode(kind === 'offline' ? 'You are offline. The saved run plays when you are back.' : 'The saved run did not load.'));
    problem.appendChild(line);
    var again = el('button', 'lp-retry', 'Try again');
    again.type = 'button';
    again.addEventListener('click', load);
    var row = el('p', 'lp-problem-row');
    if (kind === 'offline') {
      again.hidden = true;
      window.addEventListener('online', function () { again.hidden = false; }, { once: true });
    }
    row.appendChild(again);
    row.appendChild(demo);
    problem.appendChild(row);
  }

  function load() {
    frame.setAttribute('data-state', 'loading');
    window.fetch('/landing-replay.json', { credentials: 'same-origin' })
      .then(function (response) {
        if (response.status === 404) return 'empty';
        if (!response.ok) throw new Error('status ' + response.status);
        return response.json();
      })
      .then(function (digest) {
        if (digest === 'empty') return showProblem('empty');
        if (!digest || !digest.frames || !digest.leaders || digest.leaders.length !== 2) throw new Error('not a pair');
        setup(digest);
      })
      .catch(function () {
        showProblem(navigator.onLine === false ? 'offline' : 'error');
      });
  }

  load();
})();
