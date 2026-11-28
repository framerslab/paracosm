import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isAbsolute, relative, sep } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const src = new URL('../../src/', import.meta.url);
const sourceRoot = fileURLToPath(src);
const prompt = fileURLToPath(new URL('runtime/orchestrator/commander-prompt.ts', src));
const setup = fileURLToPath(new URL('runtime/orchestrator/commander-setup.ts', src));
const resolution = { moduleResolution: ts.ModuleResolutionKind.Bundler };

function localSpecifiers(file: ts.SourceFile): string[] {
  const specifiers: string[] = [];
  function visit(node: ts.Node): void {
    let specifier: ts.Node | undefined;
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      specifier = node.moduleSpecifier;
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      specifier = node.arguments[0];
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      specifier = node.argument.literal;
    }
    if (specifier && ts.isStringLiteralLike(specifier) && specifier.text.startsWith('.')) {
      specifiers.push(specifier.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return specifiers;
}

function localDependencies(entry: string): Set<string> {
  const visited = new Set<string>();
  function visit(path: string): void {
    const name = relative(sourceRoot, path);
    if (visited.has(name)) return;
    visited.add(name);
    const file = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
    for (const specifier of localSpecifiers(file)) {
      const target = ts.resolveModuleName(specifier, path, resolution, ts.sys).resolvedModule?.resolvedFileName;
      assert.ok(target, `${name} could not resolve ${specifier}`);
      const targetName = relative(sourceRoot, target);
      assert.ok(!targetName.startsWith('..' + sep) && !isAbsolute(targetName), `${name} resolved outside src`);
      visit(target);
    }
  }
  visit(entry);
  return visited;
}

test('the commander prompt graph stays independent of the model-call layer', () => {
  assert.ok(localDependencies(setup).has(['llm', 'sendAndValidate.ts'].join(sep)), 'setup is the positive control');
  const modelCalls = [...localDependencies(prompt)].filter(path => path.startsWith('llm' + sep));
  assert.deepEqual(modelCalls, []);
});

test('commander setup re-exports the original prompt values', async () => {
  const pure = await import('../../src/runtime/orchestrator/commander-prompt.js');
  const old = await import('../../src/runtime/orchestrator/commander-setup.js');
  for (const name of [
    'buildPersonalityCue', 'buildCommanderBootstrap', 'buildEffectsBlock',
    'RISK_BAR_SLOPE', 'riskAppetite', 'COST_MULTIPLES', 'breakEvenChance', 'riskBar',
    'BAR_DEPARTURE_FIELD', 'decisionRuleNumbers', 'buildDecisionRule', 'checkBarDeparture',
    'summarizeBarChecks', 'buildCommanderTurnPrompt',
  ] as const) {
    assert.ok(Object.hasOwn(pure, name), `the pure module exports ${name}`);
    assert.strictEqual(old[name], pure[name], `setup re-exports ${name}`);
  }
});
