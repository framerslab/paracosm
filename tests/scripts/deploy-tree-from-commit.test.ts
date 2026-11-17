import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '../..');
const workflow = readFileSync(resolve(root, '.github/workflows/deploy.yml'), 'utf8');
function job(name: string): string {
  return workflow.split(`\n  ${name}:\n`)[1]?.split(/\n  [\w-]+:\n/)[0] ?? '';
}
function step(body: string, name: string): string {
  return body.split(`- name: ${name}\n`)[1]?.split(/\n      - /)[0] ?? '';
}
function run(body: string): string {
  const lines = body.split('\n');
  const start = lines.findIndex(line => /^        run: \|$/.test(line));
  assert.notEqual(start, -1, 'the step has a shell run block');
  const result: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() && !line.startsWith('          ')) break;
    result.push(line.slice(10));
  }
  return result.join('\n');
}
function put(dir: string, path: string, text: string): void {
  mkdirSync(dirname(resolve(dir, path)), { recursive: true });
  writeFileSync(resolve(dir, path), text);
}

test('the deploy starts the server from built files', () => {
  const build = job('build');
  assert.match(build, /node scripts\/pack-dashboard\.mjs/);
  assert.ok(build.indexOf('node scripts/pack-dashboard.mjs') < build.indexOf('name: Upload build artifacts'));
  const remote = step(job('deploy'), 'Deploy to Linode');
  assert.match(remote, /pm2 start dist\/cli\/serve\.js/);
  assert.doesNotMatch(remote, /\bnpx\b/);
  assert.match(remote, /--max-memory-restart 1200M/);
  assert.match(remote, /PARACOSM_CLIENT_IP_HEADER=cf-connecting-ip PARACOSM_ALLOWED_ORIGINS=https:\/\/paracosm\.agentos\.sh pm2 start/);
});

test('the server output is compiled separately with install scripts disabled', () => {
  const compiled = job('compiled-server');
  assert.match(compiled, /npm ci --ignore-scripts --no-audit --no-fund/);
  assert.match(compiled, /node node_modules\/typescript\/bin\/tsc -p tsconfig.build.json/);
  assert.doesNotMatch(compiled, /npm run|npm install|dashboard:build/);
  assert.match(compiled, /persist-credentials: false/);
  assert.match(job('deploy'), /needs: \[build, server-install, compiled-server\]/);
});

test('the deploy tree takes source and manifests from the commit', () => {
  const deploy = job('deploy');
  assert.match(deploy, /ref: \$\{\{ github.sha \}\}/);
  assert.match(deploy, /path: commit/);
  assert.match(deploy, /persist-credentials: false/);
  const assembly = run(step(deploy, 'Assemble deploy tree'));
  const dir = mkdtempSync(resolve(tmpdir(), 'deploy-tree-'));
  try {
    for (const path of ['assets/a', 'scenarios/a', 'scripts/a', 'src/server/server-app.ts', 'config/a',
      'package-lock.json', 'typedoc.json', 'tsconfig.json', 'tsconfig.build.json', '.env.example']) {
      put(dir, `commit/${path}`, `commit ${path}\n`);
      put(dir, `built/${path}`, `build ${path}\n`);
    }
    const manifest = { name: 'paracosm', version: '0.9.0', scripts: { start: 'committed' } };
    put(dir, 'commit/package.json', JSON.stringify(manifest));
    put(dir, 'built/package.json', JSON.stringify({ version: '99.0.0', scripts: { start: 'other' } }));
    for (const path of ['dist/dashboard/landing.html',
      'dist/dashboard/dist/index.html', 'src/dashboard/dist/index.html', 'docs/api/index.html']) {
      put(dir, `built/${path}`, `built ${path}\n`);
    }
    for (const path of ['cli/serve.js', 'server/server-app.js']) {
      put(dir, `compiled/${path}`, `built dist/${path}\n`);
      put(dir, `built/dist/${path}`, 'other output\n');
    }
    const result = spawnSync('bash', ['-e', '-c', assembly], {
      cwd: dir, env: { ...process.env, VERSION: '0.9.1234' }, encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    for (const path of ['src/server/server-app.ts', 'package-lock.json', 'scripts/a', '.env.example']) {
      assert.equal(readFileSync(resolve(dir, `build/${path}`), 'utf8'), `commit ${path}\n`);
    }
    assert.deepEqual(JSON.parse(readFileSync(resolve(dir, 'build/package.json'), 'utf8')), { ...manifest, version: '0.9.1234' });
    for (const path of ['dist/cli/serve.js', 'dist/dashboard/landing.html', 'src/dashboard/dist/index.html', 'docs/api/index.html']) {
      assert.equal(readFileSync(resolve(dir, `build/${path}`), 'utf8'), `built ${path}\n`);
    }
    rmSync(resolve(dir, 'build'), { recursive: true });
    const invalid = spawnSync('bash', ['-e', '-c', assembly], {
      cwd: dir, env: { ...process.env, VERSION: '0.9.1\nother' }, encoding: 'utf8',
    });
    assert.notEqual(invalid.status, 0, 'a version must have three numeric parts');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the build artifact contains only dashboard and documentation outputs', () => {
  const upload = step(job('build'), 'Upload build artifacts');
  const paths = upload.split('path: |\n')[1]?.split(/\n          \S/)[0].trim().split(/\s+/);
  assert.deepEqual(paths, ['dist/dashboard/', 'src/dashboard/dist/', 'docs/api/']);
});

test('the deployed package and published package use the selected release version', () => {
  const build = job('build');
  assert.match(build, /version: \$\{\{ steps.version.outputs.version \}\}/);
  const version = run(step(build, 'Select release version'))
    .replaceAll('${{ github.run_number }}', '1234');
  const dir = mkdtempSync(resolve(tmpdir(), 'deploy-version-'));
  try {
    put(dir, 'bin/npm', '#!/bin/sh\necho 0.9.1200\n');
    // bash reads this repository helper, so no executable bit is needed.
    put(dir, 'scripts/library-changed-since-release.sh', 'echo "$LIBRARY_CHANGED"\n');
    for (const changed of ['true', 'false']) {
      put(dir, 'package.json', JSON.stringify({ version: '0.9.0' }));
      put(dir, 'outputs', '');
      const result = spawnSync('bash', ['-e', '-c', `chmod +x bin/npm\n${version}`], {
        cwd: dir, env: { ...process.env, PATH: `${dir}/bin:${process.env.PATH}`, LIBRARY_CHANGED: changed,
          GITHUB_OUTPUT: resolve(dir, 'outputs') }, encoding: 'utf8',
      });
      assert.equal(result.status, 0, result.stderr);
      const expected = changed === 'true' ? '0.9.1234' : '0.9.1200';
      assert.equal(JSON.parse(readFileSync(resolve(dir, 'package.json'), 'utf8')).version, expected);
      assert.match(readFileSync(resolve(dir, 'outputs'), 'utf8'), new RegExp(`version=${expected.replaceAll('.', '\\.')}`));
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
  for (const name of ['deploy', 'package-check']) {
    assert.match(job(name), /VERSION: \$\{\{ needs.build.outputs.version \}\}/);
  }
  assert.match(step(job('package-check'), 'Version from the run number'), /process.env.VERSION/);
  const server = readFileSync(resolve(root, 'src/server/server-app.ts'), 'utf8');
  assert.match(server, /resolve\(__dirname, '\.\.', '\.\.', 'package.json'\)/);
  assert.match(server, /version: PARACOSM_VERSION/);
});
