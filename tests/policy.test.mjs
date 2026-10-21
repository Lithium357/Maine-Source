import test from 'node:test';
import assert from 'node:assert/strict';
import { assessLicense, evaluate, licenseMatches, normalizeLicense, licenseIds } from '../src/policy.mjs';
import { defaultRecipe } from '../src/catalog.mjs';
const record = (rights = {}) => ({ title: 'Example', text: 'A useful engineering explanation about parsing and memory safety.', hash: 'one', version: '123', rights: { expression: 'MIT', basis: 'content-notice', scope: 'file', url: 'https://example.org/license', corroborated: true, ...rights } });

test('full SPDX list is available, including uncommon licenses', () => { assert.ok(licenseIds.length > 600); assert.ok(licenseIds.includes('BlueOak-1.0.0')); });
test('normalizes SPDX case, display labels, and Creative Commons license URLs', () => { assert.equal(normalizeLicense('mit'), 'MIT'); assert.equal(normalizeLicense('CC BY-SA 4.0'), 'CC-BY-SA-4.0'); assert.equal(normalizeLicense('https://creativecommons.org/licenses/by-sa/4.0/'), 'CC-BY-SA-4.0'); assert.equal(normalizeLicense('https://creativecommons.org/publicdomain/zero/1.0/'), 'CC0-1.0'); assert.equal(normalizeLicense('NOASSERTION'), null); });
test('AND requires both terms; OR permits a matching option', () => { assert.equal(licenseMatches('MIT AND Apache-2.0', ['MIT']), false); assert.equal(licenseMatches('MIT OR Apache-2.0', ['MIT']), true); assert.equal(licenseMatches('(MIT OR BSD-3-Clause) AND Apache-2.0', ['MIT', 'Apache-2.0']), true); });
test('an excluded term overrides OR permission', () => { assert.equal(licenseMatches('MIT OR GPL-3.0-only', ['MIT'], ['GPL-3.0-only']), false); });
test('SPDX exceptions require the exact permitted expression', () => { assert.equal(licenseMatches('GPL-2.0-only WITH Classpath-exception-2.0', ['GPL-2.0-only']), false); assert.equal(licenseMatches('GPL-2.0-only WITH Classpath-exception-2.0', ['GPL-2.0-only WITH Classpath-exception-2.0']), true); });
test('exception-specific exclusions are enforced', () => { assert.equal(licenseMatches('MIT OR GPL-2.0-only WITH Classpath-exception-2.0', ['MIT'], ['GPL-2.0-only WITH Classpath-exception-2.0']), false); });
for (let level = 1; level <= 10; level++) {
  test(`unknown evidence at level ${level}`, () => assert.equal(assessLicense(record({ expression: null }), { ...defaultRecipe(), strictness: level }).accepted, level <= 2));
  test(`CC0 allowlist never admits MIT at level ${level}`, () => assert.equal(assessLicense(record(), { ...defaultRecipe(), strictness: level, licenseMode: 'allowlist', allowLicenses: ['CC0-1.0'] }).accepted, false));
  test(`CC0 allowlist never admits unknown at level ${level}`, () => assert.equal(assessLicense(record({ expression: null }), { ...defaultRecipe(), strictness: level, licenseMode: 'allowlist', allowLicenses: ['CC0-1.0'] }).accepted, false));
  test(`corroborated content evidence is accepted at level ${level}`, () => assert.equal(assessLicense(record(), { ...defaultRecipe(), strictness: level }).accepted, true));
}
test('every slider step adds an actual requirement', () => {
  const transitions = [
    [1, { conflict: true }], [2, { expression: null }], [3, { basis: 'inferred' }],
    [4, { url: null }], [5, { scope: 'source' }], [6, { scope: 'repository' }],
    [7, { versionMissing: true }], [8, { basis: 'source-declaration' }], [9, { corroborated: false }],
  ];
  for (const [level, rights] of transitions) { const r = record(rights); if (rights.versionMissing) delete r.version; assert.equal(assessLicense(r, { ...defaultRecipe(), strictness: level }).accepted, true, `level ${level}`); assert.equal(assessLicense(r, { ...defaultRecipe(), strictness: level + 1 }).accepted, false, `level ${level + 1}`); }
});
test('disabling license gate keeps unknown records without claiming clearance', () => { const result = assessLicense(record({ expression: null }), { ...defaultRecipe(), licenseMode: 'off', strictness: 10 }); assert.equal(result.accepted, true); assert.match(result.warning, /not cleared/); });
test('all-rights-reserved is excluded when gate enabled', () => assert.equal(assessLicense(record({ expression: 'LicenseRef-All-Rights-Reserved' }), { ...defaultRecipe(), strictness: 1 }).accepted, false));
test('blacklist supports whole words, Unicode, phrases, literal regex chars and case', () => {
  const recipe = { ...defaultRecipe(), blacklist: 'cats\nc++\nmémoire' };
  assert.equal(evaluate({ ...record(), text: 'Cats are here' }, recipe).accepted, false);
  assert.equal(evaluate({ ...record(), text: 'Cats are here' }, { ...recipe, caseSensitive: true, minLength: 0 }).accepted, true);
  assert.equal(evaluate({ ...record(), text: 'Concatenation is a common topic in engineering text.' }, recipe).accepted, true);
  assert.equal(evaluate({ ...record(), text: 'C++ programming with safe data structures and memory management.' }, recipe).accepted, false);
  assert.equal(evaluate({ ...record(), text: 'MÉMOIRE in this useful engineering explanation.' }, recipe).accepted, false);
});
test('duplicates and short text are rejected before writing', () => { assert.equal(evaluate(record(), defaultRecipe(), new Set(['one'])).kind, 'duplicate'); assert.equal(evaluate({ ...record(), text: 'tiny' }, defaultRecipe()).kind, 'empty'); });
