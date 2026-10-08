import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const script = resolve(import.meta.dirname, '..', '..', 'scripts', 'library-changed-since-release.sh');

/** Runs git in `dir`, quietly. */
function git(dir: string, ...args: string[]): void {
  execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
}

/** A repository whose first commit holds README.md and src/index.ts. */
function repository(): string {
  const dir = mkdtempSync(join(tmpdir(), 'library-changed-'));
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  git(dir, 'config', 'tag.gpgsign', 'false');
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'README.md'), 'readme\n');
  writeFileSync(join(dir, 'src', 'index.ts'), 'export {};\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'first');
  return dir;
}

/** Commits a change to one file. */
function change(dir: string, file: string): void {
  writeFileSync(join(dir, file), `changed ${Date.now()}\n`);
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', `change ${file}`);
}

/** The script's verdict in `dir`. */
function verdict(dir: string): string {
  return execFileSync('bash', [script], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

test('a history with no release tag publishes', () => {
  const dir = repository();
  try {
    assert.equal(verdict(dir), 'true');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a documentation change since the release tag publishes nothing', () => {
  const dir = repository();
  try {
    git(dir, 'tag', 'v0.9.1');
    change(dir, 'README.md');
    assert.equal(verdict(dir), 'false');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a source change since the release tag publishes, however many commits ago', () => {
  const dir = repository();
  try {
    git(dir, 'tag', 'v0.9.1');
    change(dir, 'src/index.ts');
    change(dir, 'README.md');
    assert.equal(verdict(dir), 'true');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a pre-release tag is not the baseline', () => {
  const dir = repository();
  try {
    git(dir, 'tag', 'v0.9.1');
    change(dir, 'src/index.ts');
    git(dir, 'tag', 'v0.9.2-rc.1');
    change(dir, 'README.md');
    assert.equal(verdict(dir), 'true');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
