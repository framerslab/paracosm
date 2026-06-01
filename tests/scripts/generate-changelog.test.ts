import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCommit,
  classifyCommit,
  extractNarratives,
  extractLockedEntries,
  detectBoundaries,
  sliceCommits,
  renderBullet,
  renderEntry,
} from '../../scripts/generate-changelog.mjs';

test('parseCommit extracts type, scope, breaking, subject from "feat(runtime): add X"', () => {
  const c = parseCommit({
    sha: 'abc1234567890abcdef1234567890abcdef12345',
    subject: 'feat(runtime): add new client factory',
    body: '',
    author: 'Jane Dev',
  });
  assert.equal(c.type, 'feat');
  assert.equal(c.scope, 'runtime');
  assert.equal(c.breaking, false);
  assert.equal(c.subject, 'add new client factory');
});

test('parseCommit recognises breaking-change ! marker', () => {
  const c = parseCommit({
    sha: '0'.repeat(40),
    subject: 'feat!: drop deprecated field',
    body: '',
    author: 'Jane Dev',
  });
  assert.equal(c.type, 'feat');
  assert.equal(c.breaking, true);
  assert.equal(c.subject, 'drop deprecated field');
});

test('parseCommit recognises breaking-change via body trailer', () => {
  const c = parseCommit({
    sha: '0'.repeat(40),
    subject: 'refactor(core): reshape internals',
    body: 'Body prose.\n\nBREAKING CHANGE: consumer must update field names.',
    author: 'Jane Dev',
  });
  assert.equal(c.breaking, true);
});

test('parseCommit handles scope-only subjects ("dashboard: X")', () => {
  const c = parseCommit({
    sha: '0'.repeat(40),
    subject: 'dashboard: fix contrast on gradient rows',
    body: '',
    author: 'Jane Dev',
  });
  assert.equal(c.type, null);
  assert.equal(c.scope, null);
  assert.equal(c.breaking, false);
  assert.equal(c.subject, 'dashboard: fix contrast on gradient rows', 'scope-only keeps full subject');
});

test('parseCommit handles no-prefix subjects ("Update README.md")', () => {
  const c = parseCommit({
    sha: '0'.repeat(40),
    subject: 'Update README.md',
    body: '',
    author: 'Jane Dev',
  });
  assert.equal(c.type, null);
  assert.equal(c.scope, null);
  assert.equal(c.subject, 'Update README.md');
});

test('classifyCommit: feat goes to features', () => {
  const c = parseCommit({ sha: '0'.repeat(40), subject: 'feat: add X', body: '', author: 'X' });
  assert.equal(classifyCommit(c), 'features');
});

test('classifyCommit: fix goes to bugfixes', () => {
  const c = parseCommit({ sha: '0'.repeat(40), subject: 'fix: repair Y', body: '', author: 'X' });
  assert.equal(classifyCommit(c), 'bugfixes');
});

test('classifyCommit: perf goes to performance', () => {
  const c = parseCommit({ sha: '0'.repeat(40), subject: 'perf: tighten loop', body: '', author: 'X' });
  assert.equal(classifyCommit(c), 'performance');
});

test('classifyCommit: feat! goes to breaking (not features)', () => {
  const c = parseCommit({ sha: '0'.repeat(40), subject: 'feat!: drop Z', body: '', author: 'X' });
  assert.equal(classifyCommit(c), 'breaking');
});

test('classifyCommit: refactor with BREAKING CHANGE body goes to breaking', () => {
  const c = parseCommit({
    sha: '0'.repeat(40),
    subject: 'refactor: rename things',
    body: 'BREAKING CHANGE: renamed foo to bar',
    author: 'X',
  });
  assert.equal(classifyCommit(c), 'breaking');
});

test('classifyCommit: scope-only "dashboard:" goes to other', () => {
  const c = parseCommit({ sha: '0'.repeat(40), subject: 'dashboard: tweak UI', body: '', author: 'X' });
  assert.equal(classifyCommit(c), 'other');
});

test('classifyCommit: chore goes to other', () => {
  const c = parseCommit({ sha: '0'.repeat(40), subject: 'chore: bump deps', body: '', author: 'X' });
  assert.equal(classifyCommit(c), 'other');
});

test('classifyCommit: docs goes to other', () => {
  const c = parseCommit({ sha: '0'.repeat(40), subject: 'docs: update README', body: '', author: 'X' });
  assert.equal(classifyCommit(c), 'other');
});

test('extractNarratives: empty / missing input returns empty map', () => {
  const result = extractNarratives('');
  assert.equal(result.size, 0);
});

test('extractNarratives: entry with narrative captures it', () => {
  const input = `# Changelog

## 0.5.0 (2026-04-21)

This is the narrative. It spans one paragraph.

### Features
- foo ([abc1234](url))
`;
  const result = extractNarratives(input);
  assert.equal(result.get('0.5.0'), 'This is the narrative. It spans one paragraph.');
});

test('extractNarratives: multi-paragraph narrative preserved', () => {
  const input = `# Changelog

## 0.5.0 (2026-04-21)

First paragraph of narrative.

Second paragraph.

### Features
- foo ([abc1234](url))
`;
  const result = extractNarratives(input);
  assert.equal(
    result.get('0.5.0'),
    'First paragraph of narrative.\n\nSecond paragraph.',
  );
});

test('extractNarratives: entry with no narrative returns empty string for that version', () => {
  const input = `# Changelog

## 0.5.0 (2026-04-21)

### Features
- foo ([abc1234](url))
`;
  const result = extractNarratives(input);
  assert.equal(result.get('0.5.0'), '');
});

test('extractNarratives: multiple entries, mixed narratives', () => {
  const input = `# Changelog

## 0.5.0 (2026-04-21)

Narrative for 0.5.0.

### Features
- foo ([abc1234](url))

---

## 0.4.0 (2026-02-15)

### Features
- old ([def5678](url))
`;
  const result = extractNarratives(input);
  assert.equal(result.get('0.5.0'), 'Narrative for 0.5.0.');
  assert.equal(result.get('0.4.0'), '');
});

test('detectBoundaries: finds every major.minor change and filters run-number writes', () => {
  const mockGit = (args: string[]): string => {
    if (args[0] === 'log' && args.includes('--diff-filter=M')) {
      // git log returns newest-first. CI run-number writes (0.4.47)
      // touch package.json but don't change major.minor and must be
      // filtered. The real paracosm history has one commit per
      // major.minor bump, so no ambiguity about which commit "is" the
      // boundary.
      return [
        'sha-050 2026-04-21',
        'sha-047-rn 2026-04-18',
        'sha-040 2026-02-15',
      ].join('\n');
    }
    if (args[0] === 'show') {
      const sha = args[1].split(':')[0];
      const versions: Record<string, string> = {
        'sha-050': '0.5.0',
        'sha-047-rn': '0.4.47',
        'sha-040': '0.4.0',
      };
      return JSON.stringify({ version: versions[sha] });
    }
    throw new Error(`Unexpected git call: ${args.join(' ')}`);
  };

  const boundaries = detectBoundaries({ runGit: mockGit });
  assert.equal(boundaries.length, 2);
  assert.equal(boundaries[0].version, '0.5.0');
  assert.equal(boundaries[0].sha, 'sha-050');
  assert.equal(boundaries[1].version, '0.4.0');
  assert.equal(boundaries[1].sha, 'sha-040');
});

test('detectBoundaries: filters boundaries below EARLIEST_BOUNDARY_MAJOR_MINOR', () => {
  const mockGit = (args: string[]): string => {
    if (args[0] === 'log' && args.includes('--diff-filter=M')) {
      return [
        'sha-050 2026-04-21',
        'sha-040 2026-02-15',
        'sha-030 2026-01-10',
        'sha-020 2025-12-01',
      ].join('\n');
    }
    if (args[0] === 'show') {
      const sha = args[1].split(':')[0];
      const versions: Record<string, string> = {
        'sha-050': '0.5.0',
        'sha-040': '0.4.0',
        'sha-030': '0.3.0',
        'sha-020': '0.2.0',
      };
      return JSON.stringify({ version: versions[sha] });
    }
    throw new Error(`Unexpected git call: ${args.join(' ')}`);
  };

  const boundaries = detectBoundaries({ runGit: mockGit });
  assert.equal(boundaries.length, 2, '0.3.0 and 0.2.0 filtered by EARLIEST');
  assert.deepEqual(
    boundaries.map((b: any) => b.version),
    ['0.5.0', '0.4.0'],
  );
});

test('sliceCommits: parses git log output into commit records', () => {
  const mockGit = (args: string[]): string => {
    if (args[0] === 'log') {
      return [
        'abc1234567890abcdef1234567890abcdef12345',
        '\x01feat(runtime): add X',
        '\x01Jane Dev',
        '\x01body text line 1\nbody text line 2\x02',
      ].join('');
    }
    throw new Error(`Unexpected git call: ${args.join(' ')}`);
  };
  const commits = sliceCommits('prev', 'curr', { runGit: mockGit });
  assert.equal(commits.length, 1);
  assert.equal(commits[0].subject, 'feat(runtime): add X');
  assert.equal(commits[0].author, 'Jane Dev');
  assert.equal(commits[0].body, 'body text line 1\nbody text line 2');
  assert.equal(commits[0].sha, 'abc1234567890abcdef1234567890abcdef12345');
});

test('sliceCommits: filters bot-authored commits', () => {
  const mockGit = (args: string[]): string => {
    if (args[0] === 'log') {
      return [
        'sha1\x01feat: real work\x01Jane Dev\x01\x02',
        'sha2\x01chore: update CHANGELOG\x01github-actions[bot]\x01\x02',
        'sha3\x01fix: another real fix\x01Jane Dev\x01\x02',
      ].join('');
    }
    throw new Error(`Unexpected git call: ${args.join(' ')}`);
  };
  const commits = sliceCommits('prev', 'curr', { runGit: mockGit });
  assert.equal(commits.length, 2, 'bot commit filtered');
  assert.deepEqual(
    commits.map((c: any) => c.subject),
    ['feat: real work', 'fix: another real fix'],
  );
});

test('sliceCommits: filters "chore: update CHANGELOG" subjects even from humans', () => {
  const mockGit = (args: string[]): string => {
    if (args[0] === 'log') {
      return [
        'sha1\x01chore: update CHANGELOG\x01Jane Dev\x01\x02',
        'sha2\x01feat: real\x01Jane Dev\x01\x02',
      ].join('');
    }
    throw new Error(`Unexpected git call: ${args.join(' ')}`);
  };
  const commits = sliceCommits('prev', 'curr', { runGit: mockGit });
  assert.equal(commits.length, 1);
  assert.equal(commits[0].subject, 'feat: real');
});

test('sliceCommits: filters Merge commits as belt-and-suspenders against --no-merges', () => {
  const mockGit = (args: string[]): string => {
    if (args[0] === 'log') {
      return [
        'sha1\x01Merge branch master into foo\x01Jane Dev\x01\x02',
        'sha2\x01feat: real\x01Jane Dev\x01\x02',
      ].join('');
    }
    throw new Error(`Unexpected git call: ${args.join(' ')}`);
  };
  const commits = sliceCommits('prev', 'curr', { runGit: mockGit });
  assert.equal(commits.length, 1);
  assert.equal(commits[0].subject, 'feat: real');
});

test('sliceCommits: empty git output returns empty array', () => {
  const mockGit = (args: string[]): string => {
    if (args[0] === 'log') return '';
    throw new Error(`Unexpected git call: ${args.join(' ')}`);
  };
  const commits = sliceCommits('prev', 'curr', { runGit: mockGit });
  assert.equal(commits.length, 0);
});

test('renderBullet: feat(scope) subject strips type + keeps scope', () => {
  const c = parseCommit({
    sha: 'abcdef1234567890abcdef1234567890abcdef12',
    subject: 'feat(runtime): add X',
    body: '',
    author: 'Jane',
  });
  const b = renderBullet(c);
  assert.equal(
    b,
    '- runtime: add X ([abcdef1](https://github.com/framerslab/paracosm/commit/abcdef1234567890abcdef1234567890abcdef12))',
  );
});

test('renderBullet: feat without scope strips type prefix', () => {
  const c = parseCommit({
    sha: '0'.repeat(40),
    subject: 'feat: new thing',
    body: '',
    author: 'Jane',
  });
  const b = renderBullet(c);
  assert.ok(b.startsWith('- new thing ('), `expected no scope prefix, got: ${b}`);
});

test('renderBullet: scope-only (no type) keeps the full subject', () => {
  const c = parseCommit({
    sha: '0'.repeat(40),
    subject: 'dashboard: fix contrast',
    body: '',
    author: 'Jane',
  });
  const b = renderBullet(c);
  assert.ok(b.startsWith('- dashboard: fix contrast ('));
});

test('renderEntry: groups bullets by classification, omits empty sections', () => {
  const commits = [
    parseCommit({ sha: '1'.repeat(40), subject: 'feat: a', body: '', author: 'J' }),
    parseCommit({ sha: '2'.repeat(40), subject: 'fix: b', body: '', author: 'J' }),
    parseCommit({ sha: '3'.repeat(40), subject: 'chore: c', body: '', author: 'J' }),
  ];
  const out = renderEntry({
    version: '0.5.0',
    date: '2026-04-21',
    narrative: '',
    commits,
    collapseOther: true,
  });
  assert.ok(out.includes('## 0.5.0 (2026-04-21)'));
  assert.ok(out.includes('### Features'));
  assert.ok(out.includes('### Bug Fixes'));
  assert.ok(out.includes('<details>\n<summary>Other</summary>'));
  assert.ok(!out.includes('### Performance'), 'empty section omitted');
  assert.ok(!out.includes('### Breaking Changes'), 'empty section omitted');
});

test('renderEntry: with narrative, block placed between header and first subsection', () => {
  const commits = [
    parseCommit({ sha: '1'.repeat(40), subject: 'feat: a', body: '', author: 'J' }),
  ];
  const out = renderEntry({
    version: '0.5.0',
    date: '2026-04-21',
    narrative: 'Hand-written summary paragraph.',
    commits,
    collapseOther: true,
  });
  const headerIdx = out.indexOf('## 0.5.0');
  const narrIdx = out.indexOf('Hand-written summary paragraph.');
  const featIdx = out.indexOf('### Features');
  assert.ok(headerIdx < narrIdx && narrIdx < featIdx, 'narrative sits between header and first subsection');
});

test('renderEntry: collapseOther:false renders other flat (for release-notes)', () => {
  const commits = [
    parseCommit({ sha: '1'.repeat(40), subject: 'chore: c', body: '', author: 'J' }),
  ];
  const out = renderEntry({
    version: '0.5.47',
    date: '2026-04-22',
    narrative: '',
    commits,
    collapseOther: false,
  });
  assert.ok(out.includes('### Other'), 'flat header instead of <details>');
  assert.ok(!out.includes('<details>'));
});

test('renderEntry: empty commits + no narrative still emits the header', () => {
  const out = renderEntry({
    version: '0.5.0',
    date: '2026-04-21',
    narrative: '',
    commits: [],
    collapseOther: true,
  });
  assert.ok(out.includes('## 0.5.0 (2026-04-21)'));
});

test('extractLockedEntries: returns full verbatim entry for requested versions only', () => {
  const input = `# Changelog

header prose.

## 0.5.0 (2026-04-21)

narrative A

### Features
- foo ([abc1234](url))

---

## 0.4.0 (2026-02-15)

narrative B

### Features
- bar ([def5678](url))

### Bug Fixes
- baz ([ghi9012](url))
`;
  const locked = extractLockedEntries(input, ['0.4.0']);
  assert.equal(locked.size, 1);
  const entry = locked.get('0.4.0');
  assert.ok(entry.startsWith('## 0.4.0 (2026-02-15)'));
  assert.ok(entry.includes('narrative B'));
  assert.ok(entry.includes('- bar'));
  assert.ok(entry.includes('- baz'));
  assert.ok(!entry.endsWith('---'), 'trailing separator stripped');
});

test('extractLockedEntries: missing version yields no map entry', () => {
  const locked = extractLockedEntries('# Changelog\n\n## 0.5.0 (2026-04-21)\n\n### Features\n- x\n', ['0.4.0']);
  assert.equal(locked.size, 0);
});
