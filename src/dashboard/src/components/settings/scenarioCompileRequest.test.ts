import test from 'node:test';
import assert from 'node:assert/strict';
import { buildScenarioCompileRequest } from './scenarioCompileRequest';

test('buildScenarioCompileRequest includes seed text and max searches when provided', () => {
  const request = buildScenarioCompileRequest({
    scenario: { id: 'ocean-station' },
    seedText: '  Extract risks from this mission brief.  ',
    seedUrl: '',
    webSearch: true,
    maxSearches: '7',
  });

  assert.deepEqual(request, {
    scenario: { id: 'ocean-station' },
    seedText: 'Extract risks from this mission brief.',
    webSearch: true,
    maxSearches: 7,
  });
});

test('buildScenarioCompileRequest prefers seed URL over seed text', () => {
  const request = buildScenarioCompileRequest({
    scenario: { id: 'ocean-station' },
    seedText: 'ignored when url exists',
    seedUrl: ' https://example.com/ocean ',
    webSearch: false,
    maxSearches: '5',
  });

  assert.deepEqual(request, {
    scenario: { id: 'ocean-station' },
    seedUrl: 'https://example.com/ocean',
    webSearch: false,
    maxSearches: 5,
  });
});

test('buildScenarioCompileRequest forwards explicit provider and model overrides', () => {
  const request = buildScenarioCompileRequest({
    scenario: { id: 'ocean-station' },
    seedText: '',
    seedUrl: '',
    webSearch: true,
    maxSearches: '5',
    provider: ' anthropic ',
    model: ' claude-sonnet-4-6 ',
  });

  assert.deepEqual(request, {
    scenario: { id: 'ocean-station' },
    webSearch: true,
    maxSearches: 5,
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
  });
});

test('buildScenarioCompileRequest omits empty optional enrichment fields', () => {
  const request = buildScenarioCompileRequest({
    scenario: { id: 'ocean-station' },
    seedText: '   ',
    seedUrl: '   ',
    webSearch: true,
    maxSearches: '0',
    provider: '   ',
    model: '   ',
  });

  assert.deepEqual(request, {
    scenario: { id: 'ocean-station' },
    webSearch: true,
  });
});
