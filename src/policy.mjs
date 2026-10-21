import parse from 'spdx-expression-parse';
import ids from 'spdx-license-ids' with { type: 'json' };
import deprecatedIds from 'spdx-license-ids/deprecated.json' with { type: 'json' };

export const licenseIds = [...new Set([...ids, ...deprecatedIds]), 'LicenseRef-Public-Domain', 'LicenseRef-All-Rights-Reserved', 'LicenseRef-Custom'];
const canonical = new Map(licenseIds.map(id => [id.toLowerCase(), id]));
export const levels = [
  'Allow missing and uncertain evidence; retain warnings.',
  'Allow missing evidence; exclude unresolved conflicting notices.',
  'Allow inferred terms; exclude missing evidence and conflicts.',
  'Require a source declaration; inferred terms are excluded.',
  'Require an explicit source license declaration with an evidence URL.',
  'Require a declaration scoped to the collected record or repository.',
  'Require a declaration scoped to the individual record or file.',
  'Require record-level evidence and a recorded revision or version.',
  'Require an explicit content-level notice and a recorded version.',
  'Require consistent content-level and source declarations, plus a recorded version.',
];
export function normalizeLicense(value) {
  if (!value || /^(unknown|none|noassertion|other)$/i.test(value)) return null;
  const raw = String(value).trim();
  const displayCC = raw.match(/^CC\s+(BY(?:-NC)?(?:-ND|-SA)?|BY-NC-SA|BY-NC-ND)\s+(\d\.\d)$/i);
  if (displayCC) return `CC-${displayCC[1].toUpperCase()}-${displayCC[2]}`;
  const cc = raw.match(/creativecommons\.org\/(?:licenses\/([a-z-]+)\/(\d\.\d)|publicdomain\/(zero|mark)\/1\.0)/i);
  if (cc) return cc[3] === 'zero' ? 'CC0-1.0' : cc[3] === 'mark' ? 'LicenseRef-Public-Domain' : `CC-${cc[1].toUpperCase()}-${cc[2]}`;
  return canonical.get(raw.toLowerCase()) || raw;
}
export function licenseMatches(expression, allowed, excluded = []) {
  let tree;
  try { tree = parse(expression); } catch { tree = { license: expression }; }
  // A named exclusion anywhere in an expression takes precedence, including OR branches.
  const leaves = node => node.license ? [node.license, ...(node.exception ? [`${node.license} WITH ${node.exception}`] : [])] : [...leaves(node.left), ...leaves(node.right)];
  if (leaves(tree).some(id => excluded.includes(id))) return false;
  const check = node => {
    if (node.license) return !allowed.length || allowed.includes(node.license + (node.exception ? ` WITH ${node.exception}` : ''));
    return node.conjunction === 'or' ? check(node.left) || check(node.right) : check(node.left) && check(node.right);
  };
  return check(tree);
}
export function assessLicense(record, recipe) {
  const e = record.rights || {};
  const expression = normalizeLicense(e.expression);
  const level = Number(recipe.strictness || 5);
  const reject = reason => ({ accepted: false, reason, license: expression || 'Unknown' });
  const accept = warning => ({ accepted: true, reason: warning || 'License policy satisfied', license: expression || 'Unknown', warning });
  if (recipe.licenseMode === 'off') return accept('License filtering disabled; terms are retained, not cleared.');
  if (expression && !licenseMatches(expression, recipe.licenseMode === 'allowlist' ? recipe.allowLicenses || [] : [], recipe.excludeLicenses || [])) return reject('License is excluded or outside the allowlist');
  if (recipe.licenseMode === 'allowlist' && (!expression || !(recipe.allowLicenses || []).length)) return reject('An explicit matching license is required by the allowlist');
  if (expression === 'LicenseRef-All-Rights-Reserved') return reject('All rights reserved');
  if (e.conflict && level >= 2) return reject('Conflicting license evidence');
  if (!expression) return level <= 2 ? accept('Unknown licensing accepted by passive policy') : reject('Missing or unrecognized license evidence');
  if (!canonical.has(expression.toLowerCase())) {
    try { parse(expression); } catch {
      if (!expression.startsWith('LicenseRef-')) return level <= 2 ? accept('Unrecognized terms; manual review needed') : reject('Unrecognized license terms');
    }
  }
  if (e.basis === 'inferred' || !e.basis) return level <= 3 ? accept('License inferred; not explicitly declared') : reject('Explicit license declaration required');
  if (level >= 5 && !e.url) return reject('License evidence URL required');
  if (level >= 6 && !['repository', 'record', 'file'].includes(e.scope)) return reject('Record or repository scoped evidence required');
  if (level >= 7 && !['record', 'file'].includes(e.scope)) return reject('Individual record or file evidence required');
  if (level >= 8 && !record.version) return reject('Recorded content version required');
  if (level >= 9 && e.basis !== 'content-notice') return reject('Explicit notice in collected content required');
  if (level >= 10 && !e.corroborated) return reject('Independent matching source declaration required');
  return accept(e.conflict ? 'Conflicting evidence accepted by passive policy' : undefined);
}
export function evaluate(record, recipe, seen = new Set()) {
  const text = String(record.text || '');
  const haystack = `${record.title || ''}\n${text}`.normalize('NFKC');
  const flags = recipe.caseSensitive ? 'u' : 'iu';
  for (const term of String(recipe.blacklist || '').split(/\r?\n/).map(s => s.trim().normalize('NFKC')).filter(Boolean)) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = recipe.wholeWords ? `(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])` : escaped;
    if (new RegExp(pattern, flags).test(haystack)) return { accepted: false, reason: `Excluded keyword: ${term}`, kind: 'keyword' };
  }
  if (text.trim().length < Number(recipe.minLength || 0)) return { accepted: false, reason: 'Below minimum text length', kind: 'empty' };
  if (recipe.deduplicate && seen.has(record.hash)) return { accepted: false, reason: 'Duplicate content in this job', kind: 'duplicate' };
  return { ...assessLicense(record, recipe), kind: 'license' };
}
