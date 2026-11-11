/**
 * The Event Director's rules on how the bold and the safe option differ
 * reach every scenario, the ones with their own director instructions
 * included (#248).
 *
 * A scenario's own instructions replaced the default ones, and the default
 * held the only rules on writing a real trade-off. Six bundled scenarios
 * carry their own (Atlas Lab, Corporate Quarterly, the dual
 * superintelligence council, Lunar Outpost, Mars Genesis and the
 * submarine), so none of them received the rules. In the 29 events the
 * director wrote in three live Mars pairs (8 and 10 November 2026) the
 * bold option was `option_b` every time and its label carried a shortcut,
 * speed or hazard word in 27 ("bypass" in 15): the bold option read as
 * skipping a safety step, not as a bet.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as director from '../../src/runtime/orchestrator/director.js';
import { marsScenario } from '../../src/engine/scenarios/index.js';

/**
 * The system text a director call sends for these instructions. Where the
 * code has no assembler, it is the scenario's own text, as the call sent it.
 */
function sent(instructions: string | undefined): string {
  const assemble = (director as any).directorSystemInstructions;
  return typeof assemble === 'function'
    ? assemble(instructions, 2)
    : String(instructions ?? '').replace('{MAX_EVENTS}', '2');
}

const TRADE_OFF = 'The risky option should be neither obviously stupid nor obviously correct.';
const BET = /The risky option is a bet on a larger gain/;
const NOT_A_SHORTCUT = /never the omission of a safety step/;
const ANY_ID = /Any of the ids may be the risky option/;

const ownInstructions = (file: string): string => {
  const json = JSON.parse(readFileSync(new URL(`../../scenarios/${file}`, import.meta.url), 'utf-8'));
  return json.dataDrivenHooks.directorInstructions as string;
};

const count = (text: string, part: string) => text.split(part).length - 1;

test('a Mars Genesis run\'s director instructions hold the trade-off rules and the bet rule', () => {
  const text = sent(marsScenario.hooks.directorInstructions?.());
  assert.match(text, BET);
  assert.match(text, NOT_A_SHORTCUT);
  assert.match(text, ANY_ID);
  assert.equal(count(text, TRADE_OFF), 1);
  assert.ok(text.startsWith(marsScenario.hooks.directorInstructions!()), 'the scenario\'s own text comes first');
});

test('each bundled scenario with its own director instructions receives the rules', () => {
  for (const file of ['atlas-lab.json', 'corporate-quarterly.json', 'dual-superintelligence-council.json', 'lunar.json', 'mars.json', 'submarine.json']) {
    const own = ownInstructions(file);
    assert.ok(own.length > 50, `${file} carries its own instructions`);
    const text = sent(own);
    assert.match(text, BET, file);
    assert.match(text, NOT_A_SHORTCUT, file);
    assert.equal(count(text, TRADE_OFF), 1, file);
  }
});

test('a run with no scenario instructions sends the default with the rules once', () => {
  const text = sent(undefined);
  assert.match(text, BET);
  assert.equal(count(text, TRADE_OFF), 1);
  assert.match(text, /You generate 1 to 2 events per turn/);
});
