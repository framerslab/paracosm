/**
 * Paracosm CHANGELOG + release-notes generator.
 *
 * Produces CHANGELOG.md (committed; grouped by major.minor) and
 * release-notes.md (ephemeral CI artifact; passed to `gh release create
 * --notes-file`). Runs offline with zero deps; only shells out to `git`.
 *
 * Spec: docs/superpowers/specs/2026-04-22-p15-automated-changelog-design.md
 *
 * @module scripts/generate-changelog
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * The earliest major.minor boundary to render in the output. Boundaries
 * below this floor (e.g. 0.3.0, 0.2.0 pre-npm-publish entries) are
 * dropped even if git history contains them. Single source of truth:
 * bump to include older history.
 */
export const EARLIEST_BOUNDARY_MAJOR_MINOR = '0.4.0';

/**
 * Versions in this list are preserved verbatim (narrative plus all
 * subsections) across regeneration. Used to freeze backfill-era entries
 * whose commit messages predate this repo's conventional-commit adoption
 * and were hand-recategorized by a human. Post-backfill entries
 * (everything from 0.5.0 forward) rely on commit-message discipline and
 * should NOT be added here.
 */
export const LOCKED_ENTRY_VERSIONS = ['0.4.0'];

const REPO_URL = 'https://github.com/framerslab/paracosm';

/**
 * Fixed set of conventional-commit types the parser recognises as
 * structured prefixes. A subject like `dashboard: fix X` looks regex-wise
 * like `type: rest`, but `dashboard` isn't a conventional type — it's a
 * scope-only prefix. We treat it as non-conventional and keep the full
 * subject intact.
 */
const CONVENTIONAL_TYPES = new Set([
  'feat', 'fix', 'perf', 'refactor', 'style',
  'test', 'docs', 'chore', 'build', 'ci', 'revert',
  'security',
]);

// ---------------------------------------------------------------------------
// Pure parsing + classification
// ---------------------------------------------------------------------------

/**
 * Parse a raw git commit into the shape the classifier + renderer need.
 * Input fields are strings as git emitted them.
 */
export function parseCommit({ sha, subject, body, author }) {
  const match = /^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.*)$/.exec(subject);
  if (match && CONVENTIONAL_TYPES.has(match[1])) {
    const [, type, scope = null, bang, rest] = match;
    return {
      sha,
      shortSha: sha.slice(0, 7),
      type,
      scope,
      breaking: !!bang || /^BREAKING[ -]CHANGE:/m.test(body),
      subject: rest,
      fullSubject: subject,
      body,
      author,
    };
  }
  return {
    sha,
    shortSha: sha.slice(0, 7),
    type: null,
    scope: null,
    breaking: /^BREAKING[ -]CHANGE:/m.test(body),
    subject,
    fullSubject: subject,
    body,
    author,
  };
}

/**
 * Classify a parsed commit into one of five buckets. Order matters:
 * breaking check runs first so `feat!:` lands in breaking, not features.
 */
export function classifyCommit(c) {
  if (c.breaking) return 'breaking';
  if (c.type === 'feat') return 'features';
  if (c.type === 'fix') return 'bugfixes';
  if (c.type === 'perf') return 'performance';
  return 'other';
}

// ---------------------------------------------------------------------------
// Narrative preservation
// ---------------------------------------------------------------------------

/**
 * Parse an existing CHANGELOG.md string, returning a map of
 * version → narrative block. A narrative is everything between the
 * `## <version> (...)` header line and the first `###` subsection
 * (or the next `## ` entry, or end of file). Leading and trailing
 * whitespace and horizontal-rule separators are trimmed.
 *
 * Returns an empty Map if the input is empty or missing.
 */
export function extractNarratives(changelogText) {
  const narratives = new Map();
  // Stash raw input on the map so renderChangelog can reuse it to
  // extract locked verbatim entries without re-reading the file.
  narratives.rawText = changelogText ?? '';
  if (!changelogText) return narratives;

  const entries = changelogText.split(/(?=^## \d+\.\d+\.\d+)/m);
  for (const entry of entries) {
    const versionMatch = /^## (\d+\.\d+\.\d+)/m.exec(entry);
    if (!versionMatch) continue;
    const version = versionMatch[1];

    const headerEndIdx = entry.indexOf('\n');
    if (headerEndIdx === -1) {
      narratives.set(version, '');
      continue;
    }
    const bodyAfterHeader = entry.slice(headerEndIdx + 1);

    const subsectionIdx = bodyAfterHeader.search(/^### /m);
    const ruleIdx = bodyAfterHeader.search(/^---\s*$/m);
    const ends = [subsectionIdx, ruleIdx].filter(i => i !== -1);
    const narrativeEnd = ends.length ? Math.min(...ends) : bodyAfterHeader.length;

    const narrative = bodyAfterHeader.slice(0, narrativeEnd).trim();
    narratives.set(version, narrative);
  }
  return narratives;
}

/**
 * Extract the full verbatim entry body (header + narrative + every
 * subsection) for a list of specific versions from an existing
 * CHANGELOG.md string. Used by renderChangelog to freeze locked
 * backfill entries that shouldn't be regenerated from commits.
 *
 * Returns a Map<version, fullEntryText>. Requested versions that aren't
 * present in the input yield no map entry.
 */
export function extractLockedEntries(changelogText, wantVersions) {
  const locked = new Map();
  if (!changelogText || !wantVersions.length) return locked;

  const chunks = changelogText.split(/(?=^## \d+\.\d+\.\d+)/m);
  for (const chunk of chunks) {
    const versionMatch = /^## (\d+\.\d+\.\d+)/m.exec(chunk);
    if (!versionMatch) continue;
    const version = versionMatch[1];
    if (!wantVersions.includes(version)) continue;
    // Strip a trailing `---` separator and surrounding whitespace so
    // the composition layer can re-add separators uniformly.
    const cleaned = chunk.replace(/\n---\s*$/m, '').trimEnd();
    locked.set(version, cleaned);
  }
  return locked;
}

// ---------------------------------------------------------------------------
// Git seam
// ---------------------------------------------------------------------------

/**
 * Default git command runner. Takes an array of git arguments, returns
 * stdout as a trimmed string. Throws if git exits non-zero.
 *
 * Tests replace this via the `runGit` option so they never shell out.
 */
export function runGit(args) {
  // execFileSync preserves args as an array without shell interpretation,
  // which matters because flags like `--pretty=format:%H %cs` contain
  // literal spaces that a shell invocation would split on.
  //
  // stderr is silenced because expected failures (e.g. `git describe`
  // finding no tags yet) are handled via try/catch at the call site;
  // propagating git's stderr to the console would look alarming in CI
  // logs for what is normal behaviour.
  const out = execFileSync('git', args, {
    encoding: 'utf-8',
    maxBuffer: 128 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return out.trimEnd();
}

/**
 * Compare two `M.N.P`-style version strings on major.minor only.
 * Returns true when `candidate`'s major.minor sorts at or above `floor`.
 */
function majorMinorAtLeast(candidate, floor) {
  const [ca, cb] = candidate.split('.').map(Number);
  const [fa, fb] = floor.split('.').map(Number);
  if (ca !== fa) return ca > fa;
  return cb >= fb;
}

/**
 * Compare two M.N.P version strings; returns true when they share major
 * and minor components (run-number patch differences ignored).
 */
function sameMajorMinor(a, b) {
  const [aa, ab] = a.split('.');
  const [ba, bb] = b.split('.');
  return aa === ba && ab === bb;
}

/**
 * Walk git log for commits that modified package.json. Read each
 * commit's package.json version. Filter commits where the major.minor
 * didn't change from the previous boundary (filters CI run-number
 * writes and same-version patch commits). Also filter commits whose
 * major.minor sorts below EARLIEST_BOUNDARY_MAJOR_MINOR.
 *
 * Returns boundaries newest-first, each `{ sha, date, version }`. When
 * `runGit` is provided, uses it instead of the real git seam.
 */
export function detectBoundaries({ runGit: gitFn = runGit } = {}) {
  const raw = gitFn([
    'log',
    '--diff-filter=M',
    '--pretty=format:%H %cs',
    '--',
    'package.json',
  ]);
  if (!raw) return [];

  const rows = raw.split('\n').map(line => {
    const [sha, date] = line.split(' ');
    return { sha, date };
  });

  // Walk from oldest to newest so we can compare each against the previous
  // version; only keep boundaries that changed major.minor.
  const chronological = [...rows].reverse();
  const kept = [];
  let prevMajorMinor = null;
  for (const row of chronological) {
    const pkgRaw = gitFn(['show', `${row.sha}:package.json`]);
    let version;
    try {
      version = JSON.parse(pkgRaw).version;
    } catch {
      continue;
    }
    if (!version) continue;
    if (prevMajorMinor === null || !sameMajorMinor(version, prevMajorMinor)) {
      kept.push({ sha: row.sha, date: row.date, version });
      prevMajorMinor = version;
    }
  }

  kept.reverse();

  return kept.filter(b => majorMinorAtLeast(b.version, EARLIEST_BOUNDARY_MAJOR_MINOR));
}

/**
 * Fetch and parse commits in the range `prevSha..currSha`. Output is
 * newest-first (matching git log's default). Filters bot-authored
 * commits, `chore: update CHANGELOG` subjects, and `Merge ` prefixes.
 * Uses `\x01` (SOH) as field separator and `\x02` (STX) as record
 * separator to tolerate commit bodies containing newlines.
 */
export function sliceCommits(prevSha, currSha, { runGit: gitFn = runGit } = {}) {
  const raw = gitFn([
    'log',
    '--no-merges',
    `--pretty=format:%H%x01%s%x01%an%x01%b%x02`,
    `${prevSha}..${currSha}`,
  ]);
  if (!raw) return [];

  const records = raw.split('\x02').filter(r => r.trim().length);
  const commits = [];
  for (const record of records) {
    const [sha, subject, author, body] = record.split('\x01');
    if (!sha || !subject) continue;
    if (author === 'github-actions[bot]') continue;
    if (subject === 'chore: update CHANGELOG') continue;
    if (subject.startsWith('Merge ')) continue;
    commits.push({
      sha: sha.trim(),
      subject,
      author,
      body: body ?? '',
    });
  }
  return commits;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * Render a single commit as a CHANGELOG bullet. Conventional commits
 * drop the `type:` prefix and keep the optional scope as a label. Non-
 * conventional / scope-only commits keep their full subject intact so
 * the original reads unchanged.
 */
export function renderBullet(c) {
  const body = c.type
    ? (c.scope ? `${c.scope}: ${c.subject}` : c.subject)
    : c.subject;
  return `- ${body} ([${c.shortSha}](${REPO_URL}/commit/${c.sha}))`;
}

/**
 * Group + render one version entry. `collapseOther` controls whether the
 * "other" bucket renders inside a `<details>` block (CHANGELOG.md) or
 * flat as `### Other` (release-notes.md; GitHub Release UI handles
 * `<details>` poorly). Empty subsections are omitted.
 */
export function renderEntry({ version, date, narrative, commits, collapseOther }) {
  const groups = {
    breaking: [],
    features: [],
    bugfixes: [],
    performance: [],
    other: [],
  };
  for (const c of commits) {
    groups[classifyCommit(c)].push(c);
  }

  const lines = [`## ${version} (${date})`, ''];
  if (narrative && narrative.length) {
    lines.push(narrative, '');
  }

  const sectionOrder = [
    ['breaking', '### Breaking Changes'],
    ['features', '### Features'],
    ['bugfixes', '### Bug Fixes'],
    ['performance', '### Performance'],
  ];
  for (const [key, header] of sectionOrder) {
    if (!groups[key].length) continue;
    lines.push(header, '');
    for (const c of groups[key]) lines.push(renderBullet(c));
    lines.push('');
  }

  if (groups.other.length) {
    if (collapseOther) {
      lines.push('<details>', '<summary>Other</summary>', '');
      for (const c of groups.other) lines.push(renderBullet(c));
      lines.push('', '</details>', '');
    } else {
      lines.push('### Other', '');
      for (const c of groups.other) lines.push(renderBullet(c));
      lines.push('');
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Full-output composition
// ---------------------------------------------------------------------------

const CHANGELOG_HEADER = `# Changelog

All notable changes to paracosm are documented here. Format follows the spirit of [Keep a Changelog](https://keepachangelog.com/), grouped by major.minor version. Each \`0.M.<run_number>\` npm publish rolls into the matching major.minor entry. Per-publish detail lives in each [GitHub Release](${REPO_URL}/releases).
`;

/**
 * Build CHANGELOG.md text from boundaries + existing narratives. Each
 * boundary's commit range runs from the previous boundary's commit
 * (exclusive) to this boundary's commit (inclusive). The oldest
 * boundary has no predecessor; it ranges from the root of history.
 */
export function renderChangelog({ boundaries, narratives, gitFn }) {
  if (!boundaries.length) {
    return CHANGELOG_HEADER;
  }

  const entries = [];
  // Locked entries preserve their full previous text (including
  // manually-recategorized bullets). Non-locked entries regenerate from
  // commit history.
  const lockedEntries = extractLockedEntries(narratives.rawText ?? '', LOCKED_ENTRY_VERSIONS);

  // boundaries is newest-first; each boundary's range needs the older
  // boundary's sha as `prev`. The last entry in the list (oldest) has
  // no predecessor; use the root commit.
  for (let i = 0; i < boundaries.length; i++) {
    const current = boundaries[i];
    if (LOCKED_ENTRY_VERSIONS.includes(current.version) && lockedEntries.has(current.version)) {
      entries.push(lockedEntries.get(current.version));
      continue;
    }
    const previous = boundaries[i + 1] ?? null;
    const range = previous
      ? sliceCommits(previous.sha, current.sha, { runGit: gitFn })
      : sliceCommits(
          gitFn(['rev-list', '--max-parents=0', 'HEAD']).split('\n')[0],
          current.sha,
          { runGit: gitFn },
        );
    entries.push(renderEntry({
      version: current.version,
      date: current.date,
      narrative: narratives.get(current.version) ?? '',
      commits: range.map(parseCommit),
      collapseOther: true,
    }));
  }

  return CHANGELOG_HEADER + '\n' + entries.join('\n---\n\n') + '\n';
}

/**
 * Build release-notes.md text for the upcoming publish. Range is
 * `<last v*-tag>..HEAD`, falling back to the newest boundary's sha
 * when no `v*` tag exists yet (first-publish case). Returns a short
 * "no user-facing changes" body when the range is empty.
 */
export function renderReleaseNotes({ boundaries, gitFn }) {
  let lastTag = null;
  try {
    lastTag = gitFn(['describe', '--tags', '--abbrev=0', '--match', 'v*']);
  } catch {
    lastTag = null;
  }

  const from = lastTag ?? (boundaries[0]?.sha ?? null);
  if (!from) return 'Maintenance release; no user-facing changes.\n';

  const commits = sliceCommits(from, 'HEAD', { runGit: gitFn });
  if (!commits.length) return 'Maintenance release; no user-facing changes.\n';

  let upcomingVersion = 'Upcoming';
  try {
    const pkg = JSON.parse(readFileSync('package.json', 'utf-8'));
    if (pkg.version) upcomingVersion = pkg.version;
  } catch {
    // leave default
  }

  const today = new Date().toISOString().slice(0, 10);
  return renderEntry({
    version: upcomingVersion,
    date: today,
    narrative: '',
    commits: commits.map(parseCommit),
    collapseOther: false,
  }) + '\n';
}

// ---------------------------------------------------------------------------
// main()
// ---------------------------------------------------------------------------

export async function main() {
  const boundaries = detectBoundaries();
  const existing = existsSync('CHANGELOG.md')
    ? readFileSync('CHANGELOG.md', 'utf-8')
    : '';
  const narratives = extractNarratives(existing);

  const changelog = renderChangelog({ boundaries, narratives, gitFn: runGit });
  writeFileSync('CHANGELOG.md', changelog);

  const releaseNotes = renderReleaseNotes({ boundaries, gitFn: runGit });
  writeFileSync('release-notes.md', releaseNotes);

  console.log(`changelog: ${boundaries.length} boundary entry(ies)`);
  console.log(`release-notes: ${releaseNotes.split('\n')[0].slice(0, 80)}`);
}

// Only run when invoked directly (not when imported from tests).
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
