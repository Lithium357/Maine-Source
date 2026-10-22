import { setTimeout as delay } from 'node:timers/promises';
import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';

export class HttpClient {
  constructor({ signal, log = () => {}, fetcher = fetch, clock = Date.now, sleep = delay } = {}) {
    Object.assign(this, { signal, log, fetcher, clock, sleep });
    this.next = new Map();
  }
  async wait(ms) { if (ms > 0) await this.sleep(ms, undefined, { signal: this.signal }); }
  async request(url, { headers = {}, interval = 500, json = true, timeoutMs = 45000, method = 'GET', body, publicRedirects = false, redirectCount = 0 } = {}) {
    const endpoint = new URL(url);
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) throw new Error('Only HTTPS sources without embedded credentials are supported');
    const host = endpoint.host;
    if (publicRedirects && (method !== 'GET' || Object.keys(headers).length)) throw new Error('Public redirects cannot be used with credentials or custom headers');
    for (let attempt = 0; attempt < 4; attempt++) {
      this.signal?.throwIfAborted();
      await this.wait((this.next.get(host) || 0) - this.clock());
      this.next.set(host, this.clock() + interval);
      const timeout = AbortSignal.timeout(timeoutMs);
      const response = await this.fetcher(url, {
        method, body,
        headers: { 'User-Agent': 'MaineSource/0.1 (dataset collection; https://github.com/Lithium357/Maine-Source)', Accept: json ? 'application/json' : '*/*', ...headers },
        signal: this.signal ? AbortSignal.any([this.signal, timeout]) : timeout,
        redirect: publicRedirects ? 'manual' : 'error',
      });
      if (publicRedirects && [301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        const location = response.headers.get('location');
        if (!location || redirectCount >= 5) throw new Error(`${host}: invalid or excessive download redirects`);
        const next = new URL(location, endpoint);
        if (next.protocol !== 'https:' || next.username || next.password) throw new Error('Download redirects must use HTTPS without embedded credentials');
        return this.request(next.href, { interval, json, timeoutMs, publicRedirects: true, redirectCount: redirectCount + 1 });
      }
      const remaining = response.headers.get('x-ratelimit-remaining');
      if (remaining === '0') {
        const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000;
        this.next.set(host, Number.isFinite(reset) && reset > this.clock() ? reset : this.clock() + 60_000);
        this.log('rate', `${host}: rate limit reached; waiting before the next request.`);
      }
      if ([429, 502, 503, 504].includes(response.status) || (response.status === 403 && remaining === '0')) {
        const retry = response.headers.get('retry-after');
        const wait = retry ? (/^\d+$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - this.clock()) : 2000 * 2 ** attempt;
        await response.body?.cancel();
        if (attempt === 3) throw new Error(`${host}: request failed after retries (HTTP ${response.status})`);
        this.log('rate', `${host}: temporary limit or outage; retrying.`);
        await this.wait(Math.max(1000, Number.isFinite(wait) ? wait : 2000));
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`${host}: HTTP ${response.status}${[401, 403].includes(response.status) ? ' — check credentials and access permissions' : ''}`);
      }
      return response;
    }
  }
  async get(url, options = {}) {
    const { maxBytes = 12 * 1024 * 1024, json = true, includeHeaders = false } = options;
    const response = await this.request(url, options);
    const host = new URL(url).host;
    if (Number(response.headers.get('content-length')) > maxBytes) { await response.body?.cancel(); throw new Error(`${host}: response exceeds safety size limit`); }
    const chunks = []; let bytes = 0;
    for await (const chunk of response.body) {
      this.signal?.throwIfAborted(); bytes += chunk.length;
      if (bytes > maxBytes) throw new Error(`${host}: response exceeds safety size limit`);
      chunks.push(chunk);
    }
    const text = Buffer.concat(chunks).toString('utf8');
    const data = json ? (response.status === 204 ? null : JSON.parse(text)) : text;
    return includeHeaders ? { data, headers: response.headers } : data;
  }
  async post(url, body, options = {}) {
    return this.get(url, { ...options, method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', ...options.headers } });
  }
  async binary(url, options = {}) {
    const { maxBytes = 50 * 1024 * 1024, headers = {} } = options;
    const response = await this.request(url, { ...options, json: false, timeoutMs: 300000, publicRedirects: !Object.keys(headers).length });
    if (Number(response.headers.get('content-length')) > maxBytes) { await response.body?.cancel(); throw new Error('File exceeds download size limit'); }
    const chunks = []; let bytes = 0;
    for await (const chunk of response.body) {
      this.signal?.throwIfAborted(); bytes += chunk.length;
      if (bytes > maxBytes) throw new Error('File exceeds download size limit');
      chunks.push(chunk);
    }
    return { data: Buffer.concat(chunks), mediaType: response.headers.get('content-type')?.split(';')[0] || 'application/octet-stream' };
  }
  async *lines(url, { maxBytes = 100 * 1024 * 1024, maxLineBytes = 12 * 1024 * 1024 } = {}) {
    const response = await this.request(url, { json: false, timeoutMs: 300000, publicRedirects: true });
    if (Number(response.headers.get('content-length')) > maxBytes) { await response.body?.cancel(); throw new Error('JSONL input exceeds input byte budget'); }
    const signal = this.signal;
    const reader = response.body.getReader();
    let inputBytes = 0;
    const first = []; let firstLength = 0;
    let stream, gunzip;
    try {
      while (firstLength < 2) {
        const next = await reader.read(); if (next.done) break;
        first.push(Buffer.from(next.value)); firstLength += next.value.length;
        if (firstLength > maxBytes) throw new Error('JSONL input exceeds input byte budget');
      }
      const prefix = Buffer.concat(first);
      const chunks = async function* () {
        inputBytes += prefix.length; if (prefix.length) yield prefix;
        while (true) {
          signal?.throwIfAborted(); const next = await reader.read(); if (next.done) break;
          inputBytes += next.value.length;
          if (inputBytes > maxBytes) throw new Error('JSONL input exceeds input byte budget');
          yield Buffer.from(next.value);
        }
      };
      // Fetch already decompresses HTTP Content-Encoding; magic bytes also handle .gz files.
      let decoded = chunks();
      if (prefix[0] === 0x1f && prefix[1] === 0x8b) {
        stream = Readable.from(decoded);
        gunzip = createGunzip(); stream.on('error', error => gunzip.destroy(error));
        decoded = stream.pipe(gunzip);
      }
      const decoder = new TextDecoder('utf-8', { fatal: true });
      let pending = '', decodedBytes = 0;
      for await (const chunk of decoded) {
        signal?.throwIfAborted(); decodedBytes += chunk.length;
        if (decodedBytes > maxBytes) throw new Error('JSONL decompressed data exceeds input byte budget');
        pending += decoder.decode(chunk, { stream: true });
        let newline;
        while ((newline = pending.indexOf('\n')) !== -1) {
          const line = pending.slice(0, newline).replace(/\r$/, ''); pending = pending.slice(newline + 1);
          if (Buffer.byteLength(line) > maxLineBytes) throw new Error('JSONL row exceeds safety size limit');
          yield line;
        }
        if (Buffer.byteLength(pending) > maxLineBytes) throw new Error('JSONL row exceeds safety size limit');
      }
      pending += decoder.decode();
      if (Buffer.byteLength(pending) > maxLineBytes) throw new Error('JSONL row exceeds safety size limit');
      if (pending) yield pending.replace(/\r$/, '');
    } finally {
      await reader.cancel().catch(() => {});
      gunzip?.destroy(); stream?.destroy();
      reader.releaseLock();
    }
  }
}
