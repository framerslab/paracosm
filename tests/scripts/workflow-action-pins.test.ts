import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const workflows = resolve(import.meta.dirname, '..', '..', '.github', 'workflows');

function unpinnedActionLines(source: string): string[] {
  const unpinned: string[] = [];

  for (const [index, line] of source.split(/\r?\n/).entries()) {
    const match = /^\s*(?:-\s+)?(?:uses|'uses'|"uses")\s*:\s*(\S*)(.*)$/.exec(line);
    if (!match) continue;
    const value = match[1].replace(/^(['"])(.*)\1$/, '$2');
    const comment = match[2];
    const local = value.startsWith('./');
    const docker = /^docker:\/\/\S+@sha256:[a-fA-F0-9]{64}$/.test(value);
    const commit = /^[\w.-]+\/[\w.-]+(?:\/[\w.-]+)*@[a-fA-F0-9]{40}$/.test(value);
    const release = /^\s+# v\d+\.\d+\.\d+(?:[-+][\w.-]+)?(?:\s|$)/.test(comment);

    if (!local && !docker && !(commit && release)) {
      unpinned.push(`${index + 1}: ${line.trim()}`);
    }
  }

  return unpinned;
}

test('workflow action keys accept quotes and spacing', () => {
  const keys = ['uses:', 'uses :', '"uses":', "'uses':", '"uses" :', "'uses' :"];
  const lines = keys.flatMap((key) => [
    `      - ${key} actions/checkout@v7`,
    `        ${key} actions/checkout@v7`,
  ]);

  assert.deepEqual(
    unpinnedActionLines(lines.join('\n')),
    lines.map((line, index) => `${index + 1}: ${line.trim()}`),
  );
});

test('every workflow action is referenced by commit', () => {
  const unpinned: string[] = [];

  for (const file of readdirSync(workflows, { withFileTypes: true })) {
    if (!file.isFile()) continue;
    const source = readFileSync(resolve(workflows, file.name), 'utf8');
    for (const line of unpinnedActionLines(source)) {
      unpinned.push(`${file.name}:${line}`);
    }
  }

  assert.deepEqual(unpinned, [], `Workflow actions must reference a commit and release:\n${unpinned.join('\n')}`);
});
