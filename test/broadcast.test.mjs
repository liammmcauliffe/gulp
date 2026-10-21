import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeNetwork,
  candidatesForNetworks,
  NETWORK_STREAMS,
} from '../public/broadcast-shared.js';

test('normalizeNetwork handles ESPN broadcast names', () => {
  assert.equal(normalizeNetwork('USA Net'), 'usa');
  assert.equal(normalizeNetwork('E!'), 'e');
  assert.equal(normalizeNetwork('FS1'), 'fs1');
  assert.equal(normalizeNetwork('NFL Net'), 'nfln');
  assert.equal(normalizeNetwork('truTV'), 'trutv');
  assert.equal(normalizeNetwork('ESPN2'), 'espn2');
  assert.equal(normalizeNetwork('SECN'), 'sec');
  assert.equal(normalizeNetwork('ACCN'), 'acc');
  assert.equal(normalizeNetwork('BTN'), 'btn');
  assert.equal(normalizeNetwork('NBA TV'), 'nbatv');
  assert.equal(normalizeNetwork('TNT'), 'tnt');
  assert.equal(normalizeNetwork('CNBC'), 'cnbc');
  assert.equal(normalizeNetwork('Fox'), null);
  assert.equal(normalizeNetwork('FOX'), null);
  assert.equal(normalizeNetwork('Peacock'), null);
});

test('candidates flatten USA then E! in ESPN order', () => {
  const { urls, networks } = candidatesForNetworks(['USA Net', 'CNBC', 'Peacock', 'E!']);
  assert.deepEqual(networks, ['USA Net', 'CNBC', 'E!']);
  assert.equal(urls[0], NETWORK_STREAMS.usa[0]);
  assert.ok(urls.includes(NETWORK_STREAMS.e[0]));
  assert.ok(urls.indexOf(NETWORK_STREAMS.usa[0]) < urls.indexOf(NETWORK_STREAMS.e[0]));
});
