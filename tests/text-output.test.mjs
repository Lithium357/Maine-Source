import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { zipSync } from 'fflate';
import { Collector } from '../src/engine.mjs';
import { defaultTextOutput, validateTextOutput, textExportExtension } from '../src/output-options.mjs';
import { encodeText, transformText, latexSources, renderText } from '../src/text-output.mjs';

for (const [encoding, expected, bom] of [
  ['utf8', '41f09f9880c3a9', 'efbbbf'],
  ['utf16le', '41003dd800dee900', 'fffe'],
  ['utf16be', '0041d83dde0000e9', 'feff'],
  ['utf32le', '4100000000f60100e9000000', 'fffe0000'],
  ['utf32be', '000000410001f600000000e9', '0000feff'],
]) test(`${encoding} encodes non-BMP characters and explicit BOM exactly`, () => {
  assert.equal(encodeText('A😀é', { encoding, bom: 'never' }).toString('hex'), expected);
  assert.equal(encodeText('A😀é', { encoding, bom: 'always' }, { first: true }).toString('hex'), bom + expected);
  assert.equal(encodeText('A😀é', { encoding, bom: 'always' }).toString('hex'), expected);
  assert.equal(encodeText('A😀é', { encoding }, { first: true }).toString('hex'), (encoding === 'utf8' ? '' : bom) + expected);
});
test('normalization is explicit and line ending conversion preserves indentation', () => {
  const input = 'e\u0301  ①\r\n\tcode\rnext\n';
  assert.equal(transformText(input, {}), input);
  assert.equal(transformText(input, { normalization: 'NFC', newlines: 'lf' }), 'é  ①\n\tcode\nnext\n');
  assert.equal(transformText(input, { normalization: 'NFKC', newlines: 'crlf' }), 'é  1\r\n\tcode\r\nnext\r\n');
  assert.equal(transformText('é', { normalization: 'NFD' }), 'e\u0301');
});
test('invalid or lossy encoding requests fail instead of silently substituting', () => {
  for (const options of [null, [], { encoding: 'ascii' }, { unexpected: true }, { representation: 'scsu' }]) assert.throws(() => validateTextOutput(options));
  assert.throws(() => encodeText('\ud800', {}), /unpaired/);
  assert.equal(textExportExtension({ representation: 'latex', compression: 'gzip' }), 'tex.gz');
  assert.equal(textExportExtension({ representation: 'originals', compression: 'gzip' }), 'originals.jsonl');
});
function tar(name, bytes) {
  const data = Buffer.from(bytes), header = Buffer.alloc(512);
  header.write(name); header.write(data.length.toString(8).padStart(11, '0') + '\0', 124); header[156] = 48; header.write('ustar', 257);
  return Buffer.concat([header, data, Buffer.alloc((512 - data.length % 512) % 512), Buffer.alloc(1024)]);
}
async function fixture() {
  await mkdir('.test-data', { recursive: true });
  const root = await mkdtemp(path.resolve('.test-data', 'text-output-')), id = 'output-test';
  const run = path.join(root, id); await mkdir(path.join(run, 'records'), { recursive: true });
  await mkdir(path.join(run, 'assets', '00000001'), { recursive: true });
  const source = gzipSync(tar('main.tex', '\\section{Actual source}\nThe full manuscript 😀.'));
  const binary = Buffer.from([0, 255, 1, 128]);
  await writeFile(path.join(run, 'assets', '00000001', '001-source.tar.gz'), source);
  await writeFile(path.join(run, 'assets', '00000001', '002-figure.bin'), binary);
  const records = [
    { id: 'paper', title: 'Paper', text: 'Extracted body e\u0301 😀', attachments: [{ filename: '001-source.tar.gz', path: 'assets/00000001/001-source.tar.gz' }, { filename: '002-figure.bin', path: 'assets/00000001/002-figure.bin' }] },
    { id: 'plain', title: 'Plain', text: 'Ordinary prose without LaTeX.' },
  ];
  for (const [i, record] of records.entries()) await writeFile(path.join(run, 'records', `${String(i + 1).padStart(8, '0')}.json`), JSON.stringify(record));
  const collector = new Collector({ root }); collector.jobs = [{ id, status: 'completed', accepted: 2 }];
  return { root, run, id, source, binary, collector, records };
}
test('streamed gzip UTF-32 export includes exactly one BOM and reports actual settings', async () => {
  const f = await fixture(), destination = path.join(f.root, 'output.txt.gz');
  const options = { ...defaultTextOutput(), encoding: 'utf32be', normalization: 'NFC', compression: 'gzip' };
  await f.collector.exportTo(f.id, destination, 'text', options);
  const bytes = gunzipSync(await readFile(destination));
  assert.equal(bytes.readUInt32BE(0), 0xfeff);
  const points = []; for (let i = 4; i < bytes.length; i += 4) points.push(bytes.readUInt32BE(i));
  assert.equal(points.filter(p => p === 0xfeff).length, 0);
  let text = ''; for (const point of points) text += String.fromCodePoint(point);
  assert.match(text, /Extracted body é 😀/); assert.match(text, /Ordinary prose/);
  const manifest = JSON.parse(await readFile(destination + '.manifest.json', 'utf8'));
  assert.deepEqual(manifest.textOutput, options); assert.equal(manifest.exportedRecords, 2);
});
test('LaTeX-only uses submitted source and reports records skipped without source', async () => {
  const f = await fixture(), destination = path.join(f.root, 'source.tex');
  await f.collector.exportTo(f.id, destination, 'text', { representation: 'latex' });
  const text = await readFile(destination, 'utf8');
  assert.match(text, /\\section\{Actual source\}/); assert.doesNotMatch(text, /Extracted body|Ordinary prose/);
  const manifest = JSON.parse(await readFile(destination + '.manifest.json', 'utf8'));
  assert.equal(manifest.exportedRecords, 1); assert.equal(manifest.skippedRecords, 1);
  assert.deepEqual(await readFile(destination + '.assets/assets/00000001/001-source.tar.gz'), f.source);
});
test('originals index and JSONL stay UTF-8 and originals stay byte-identical despite text preferences', async () => {
  const f = await fixture();
  for (const format of ['jsonl', 'text']) {
    const destination = path.join(f.root, format + '.jsonl');
    await f.collector.exportTo(f.id, destination, format, { representation: 'originals', encoding: 'utf32be', bom: 'always', compression: 'gzip', normalization: 'NFKC' });
    const bytes = await readFile(destination); assert.equal(bytes[0], 123);
    const records = bytes.toString('utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.equal(records[0].text, format === 'jsonl' ? f.records[0].text : undefined);
    assert.deepEqual(await readFile(path.join(f.root, records[0].attachments[0].path)), f.source);
    assert.deepEqual(await readFile(path.join(f.root, records[0].attachments[1].path)), f.binary);
    assert.equal(JSON.parse(await readFile(destination + '.manifest.json', 'utf8')).textOutput.encoding, 'utf8');
  }
  assert.deepEqual(await readFile(path.join(f.run, 'assets/00000001/002-figure.bin')), f.binary);
});
test('a LaTeX export without sources fails and leaves an existing output unchanged', async () => {
  const f = await fixture(), destination = path.join(f.root, 'keep.tex');
  await writeFile(path.join(f.run, 'records/00000001.json'), JSON.stringify(f.records[1]));
  await writeFile(destination, 'existing output');
  await assert.rejects(f.collector.exportTo(f.id, destination, 'text', { representation: 'latex' }), /No original LaTeX/);
  assert.equal(await readFile(destination, 'utf8'), 'existing output');
  assert.ok(!(await readdir(f.root)).some(name => name.endsWith('.tmp')));
});
test('LaTeX reads only .tex members of ZIP archives and supports BOM-marked direct source', async () => {
  const f = await fixture();
  const zip = zipSync({ 'nested/chapter.tex': Buffer.from('\\chapter{Real}'), 'figure.png': Buffer.from([0, 1, 2]) });
  await writeFile(path.join(f.run, 'assets/00000001/source.zip'), zip);
  await writeFile(path.join(f.run, 'assets/00000001/direct.tex'), encodeText('\\section{é😀}', { encoding: 'utf16be' }, { first: true }));
  const sources = await latexSources({ attachments: [{ filename: 'source.zip', path: 'assets/00000001/source.zip' }, { filename: 'direct.tex', path: 'assets/00000001/direct.tex' }] }, f.run);
  assert.deepEqual(sources.map(s => s.text), ['\\chapter{Real}', '\\section{é😀}']);
  await assert.rejects(latexSources({ attachments: [{ filename: 'bad.tex', path: '../escape.tex' }] }, f.run), /Invalid saved attachment/);
});
test('Markdown fences cannot be closed by source backticks and titles are escaped', async () => {
  const output = await renderText({ title: '# Unsafe [title]', text: '```\n# remains body', url: 'https://example.org' }, { representation: 'markdown' });
  assert.match(output, /^# \\# Unsafe \\\[title\\\]/);
  assert.match(output, /````text\n```\n# remains body\n````/);
});
test('a single gzipped manuscript is recognized without relabeling ordinary prose', async () => {
  const f = await fixture();
  const file = { filename: 'single.tar.gz', path: 'assets/00000001/single.tar.gz' };
  await writeFile(path.join(f.run, file.path), gzipSync(Buffer.from('\\documentclass{article}\n\\begin{document}Real source.')));
  assert.match((await latexSources({ attachments: [file] }, f.run))[0].text, /Real source/);
  await writeFile(path.join(f.run, file.path), gzipSync(Buffer.from('Ordinary prose.')));
  assert.deepEqual(await latexSources({ attachments: [file] }, f.run), []);
});
