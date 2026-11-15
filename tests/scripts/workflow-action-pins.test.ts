import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const workflows = resolve(import.meta.dirname, '..', '..', '.github', 'workflows');

test('every workflow action is referenced by commit', () => {
  const unpinned: string[] = [];

  for (const file of readdirSync(workflows, { withFileTypes: true })) {
    if (!file.isFile()) continue;
    const lines = readFileSync(resolve(workflows, file.name), 'utf8').split(/\r?\n/);

    for (const [index, line] of lines.entries()) {
      const match = /^\s*(?:-\s+)?uses:\s*(\S*)(.*)$/.exec(line);
      if (!match) continue;
      const value = match[1].replace(/^(['"])(.*)\1$/, '$2');
      const comment = match[2];
      const local = value.startsWith('./');
      const docker = /^docker:\/\/\S+@sha256:[a-fA-F0-9]{64}$/.test(value);
      const commit = /^[\w.-]+\/[\w.-]+(?:\/[\w.-]+)*@[a-fA-F0-9]{40}$/.test(value);
      const release = /^\s+# v\d+\.\d+\.\d+(?:[-+][\w.-]+)?(?:\s|$)/.test(comment);

      if (!local && !docker && !(commit && release)) {
        unpinned.push(`${file.name}:${index + 1}: ${line.trim()}`);
      }
    }
  }

  assert.deepEqual(unpinned, [], `Workflow actions must reference a commit and release:\n${unpinned.join('\n')}`);
});
