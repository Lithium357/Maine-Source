import { gunzipSync } from 'node:zlib';
import { fork } from 'node:child_process';
import { plain } from './sources/helpers.mjs';

const expandedLimit = 100 * 1024 * 1024;
const textFile = /\.(tex|bib|sty|cls|txt|md|rst|csv|tsv|json|jsonl|xml|xhtml|html?|py|js|ts|c|cpp|h|rs|go|java|r|sql|yaml|yml)$/i;
export function publicURL(address) {
  const u = new URL(address);
  for (const key of [...u.searchParams.keys()]) if (/key|token|signature|credential|secret/i.test(key)) u.searchParams.delete(key);
  return u.href;
}
export function archiveText(bytes, filename = '', { decode = data => data.toString('utf8'), include = name => textFile.test(name) } = {}) {
  let data = Buffer.from(bytes);
  if (data[0] === 0x1f && data[1] === 0x8b) data = gunzipSync(data, { maxOutputLength: expandedLimit });
  if (data.length > expandedLimit) throw new Error('Archive exceeds decompressed size limit');
  const files = []; let total = 0;
  // Read tar members in memory; never extract paths, links, scripts, or commands onto disk.
  if (data.length >= 512 && (data.subarray(257, 262).toString() === 'ustar' || /^[0-7]+\0?\s*$/.test(data.subarray(124, 136).toString().trim()))) {
    for (let offset = 0, entries = 0; offset + 512 <= data.length;) {
      const header = data.subarray(offset, offset + 512); if (header.every(b => b === 0)) break;
      const size = Number.parseInt(header.subarray(124, 136).toString().replace(/\0/g, '').trim(), 8);
      if (!Number.isSafeInteger(size) || size < 0 || offset + 512 + size > data.length) throw new Error('Invalid tar member size');
      if (++entries > 10000) throw new Error('Archive contains too many members');
      const name = header.subarray(0, 100).toString().replace(/\0.*$/, '');
      const type = header[156];
      if ([0, 48].includes(type) && include(name)) {
        const text = decode(data.subarray(offset + 512, offset + 512 + size));
        total += size; if (total > expandedLimit) throw new Error('Archive text exceeds size limit');
        files.push({ name, text });
      }
      offset += 512 + Math.ceil(size / 512) * 512;
    }
    return files;
  }
  if (!data.includes(0) && !data.subarray(0, 5).equals(Buffer.from('%PDF-'))) return [{ name: filename || 'source.tex', text: decode(data) }];
  return [];
}
export async function extractText(data, filename, mediaType, { signal } = {}) {
  signal?.throwIfAborted();
  const complex = data.subarray(0, 5).toString() === '%PDF-' || data[0] === 0x1f && data[1] === 0x8b || data.subarray(0, 2).toString() === 'PK' || /\.(tar|tgz|html?)$/i.test(filename) || /html/.test(mediaType);
  if (!complex) return extractTextInline(data, filename, mediaType, { signal });
  return new Promise((resolve, reject) => {
    const workerEnvironment = { ...process.env, ELECTRON_RUN_AS_NODE: '1' }; delete workerEnvironment.NODE_TEST_CONTEXT;
    const worker = fork(new URL('./extract-worker.mjs', import.meta.url), [], { execArgv: ['--max-old-space-size=512'], env: workerEnvironment, serialization: 'advanced', stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true });
    let settled = false;
    const finish = (error, value) => {
      if (settled) return; settled = true;
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      worker.kill(); error ? reject(error) : resolve(value);
    };
    const abort = () => finish(signal.reason || new Error('Content extraction cancelled'));
    const timer = setTimeout(() => finish(new Error('Text extraction exceeded 60 seconds; original retained')), 60000);
    signal?.addEventListener('abort', abort, { once: true });
    worker.once('message', message => finish(message.error ? new Error(message.error) : null, message.value));
    worker.once('error', error => finish(error));
    worker.once('exit', code => { if (!settled) finish(new Error(`Text extraction worker exited (${code})`)); });
    worker.send({ data: Buffer.from(data), filename, mediaType }, error => { if (error) finish(error); });
    if (signal?.aborted) abort();
  });
}
export async function extractTextInline(data, filename, mediaType, { signal } = {}) {
  signal?.throwIfAborted();
  if (data.subarray(0, 5).toString() === '%PDF-') {
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: new Uint8Array(data), isEvalSupported: false });
    const abort = () => { void parser.destroy().catch(() => {}); };
    signal?.addEventListener('abort', abort, { once: true });
    try { const result = await parser.getText(); signal?.throwIfAborted(); return { text: result.text, format: 'pdf', pages: result.total }; }
    finally { signal?.removeEventListener('abort', abort); await parser.destroy().catch(() => {}); }
  }
  if (mediaType === 'application/pdf' || /\.pdf$/i.test(filename)) throw new Error('The download is not a PDF document');
  if (/\.(zip|docx|xlsx|epub)$/i.test(filename) || data.subarray(0, 2).toString() === 'PK') {
    const { unzipSync } = await import('fflate');
    let total = 0, entries = 0;
    const files = unzipSync(data, { filter(file) {
      if (++entries > 10000) throw new Error('Archive contains too many members');
      const selected = textFile.test(file.name);
      if (selected) { total += file.originalSize; if (total > expandedLimit) throw new Error('Archive exceeds decompressed size limit'); }
      return selected;
    } });
    const text = Object.entries(files).map(([name, body]) => `\n--- ${name} ---\n${/\.(xml|html?|xhtml)$/i.test(name) ? plain(Buffer.from(body).toString('utf8')) : Buffer.from(body).toString('utf8')}`).join('\n');
    return { text, format: 'zip', members: Object.keys(files) };
  }
  if (data[0] === 0x1f && data[1] === 0x8b || /\.(tar|tgz)$/i.test(filename)) {
    const files = archiveText(data, filename);
    return { text: files.map(file => `\n--- ${file.name} ---\n${file.text}`).join('\n'), format: 'source archive', members: files.map(file => file.name) };
  }
  if (!data.includes(0) && (textFile.test(filename) || /^text\//.test(mediaType) || /json|xml/.test(mediaType))) {
    const text = data.toString('utf8');
    if (/html/.test(mediaType) || /\.html?$/i.test(filename)) {
      const [{ Readability }, { JSDOM }] = await Promise.all([import('@mozilla/readability'), import('jsdom')]);
      const dom = new JSDOM(text); // No scripts or remote resources are enabled.
      try { const article = new Readability(dom.window.document).parse(); return { text: article?.textContent?.trim() || plain(text), format: 'html', mainArticleExtracted: Boolean(article) }; }
      finally { dom.window.close(); }
    }
    return { text: /html|xml/.test(mediaType) || /\.(html?|xml)$/i.test(filename) ? plain(text) : text, format: 'text' };
  }
  return { text: '', format: 'binary original' };
}

// Resolve source-owned content requests before filtering. Never fall back to an abstract silently.
export async function materialize(record, http, settings = {}) {
  const { contentRequests, ...base } = record;
  if (!contentRequests?.length) return base;
  if (settings.contentMode === 'metadata') return { ...base, metadata: { ...base.metadata, contentScope: 'metadata only (explicit selection)', contentStatus: 'metadata' } };
  const maxBytes = Math.min(500, Math.max(1, Number(settings.maxFileMB) || 50)) * 1024 * 1024;
  const totalLimit = Math.min(1000, Math.max(1, Number(settings.maxRecordMB) || 200)) * 1024 * 1024;
  const attachments = [], texts = [], failures = []; let bytes = 0, textBytes = 0;
  for (const request of contentRequests) {
    http.signal?.throwIfAborted();
    try {
      if (request.error) throw new Error(request.error);
      const result = request.data ? { data: Buffer.from(request.data), mediaType: request.mediaType || 'application/octet-stream' } : await http.binary(request.url, { interval: request.interval || 1100, maxBytes: Math.min(maxBytes, totalLimit - bytes), headers: request.headers || {} });
      const data = Buffer.from(result.data);
      if (data.length > maxBytes || bytes + data.length > totalLimit) throw new Error('Original content exceeds per-record download limit');
      if (/\.pdf$/i.test(request.filename || '') && data.subarray(0, 5).toString() !== '%PDF-') throw new Error('The server returned a non-PDF response for a paper PDF');
      bytes += data.length;
      const filename = data.subarray(0, 5).toString() === '%PDF-' && !/\.pdf$/i.test(request.filename || '') ? `${request.filename || 'original'}.pdf` : request.filename || 'original.bin';
      const attachment = { filename, data, mediaType: result.mediaType, url: request.url ? publicURL(request.url) : undefined, role: request.role || 'original' };
      attachments.push(attachment);
      try {
        const parsed = await extractText(data, filename, result.mediaType, { signal: http.signal });
        textBytes += Buffer.byteLength(parsed.text);
        if (textBytes > expandedLimit) throw new Error('Extracted text exceeds the 100 MB per-record limit; original retained');
        attachment.extraction = { ...parsed, text: undefined };
        if (parsed.text.trim()) texts.push(parsed.text);
      } catch (error) {
        http.signal?.throwIfAborted(); attachment.extraction = { error: error.message };
        failures.push({ file: filename, stage: 'extraction', message: error.message });
      }
    } catch (error) {
      http.signal?.throwIfAborted();
      failures.push({ file: request.filename || 'original', stage: 'download', message: error.message });
    }
  }
  if (!attachments.length) throw new Error(`Underlying content unavailable: ${failures.map(f => `${f.file}: ${f.message}`).join('; ')}`);
  for (const failure of failures) http.log?.('warning', `${failure.file}: ${failure.message}`);
  return { ...base, text: texts.join('\n\n'), attachments, metadata: { ...base.metadata, sourceSummary: base.text, contentScope: 'underlying content', contentStatus: failures.length ? 'partial' : 'downloaded', contentFailures: failures, extractionEmpty: !texts.length } };
}
