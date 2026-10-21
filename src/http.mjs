import { setTimeout as delay } from 'node:timers/promises';

export class HttpClient {
  constructor({ signal, log = () => {}, fetcher = fetch, clock = Date.now, sleep = delay } = {}) {
    Object.assign(this, { signal, log, fetcher, clock, sleep });
    this.next = new Map();
  }
  async wait(ms) { if (ms > 0) await this.sleep(ms, undefined, { signal: this.signal }); }
  async get(url, { headers = {}, interval = 500, maxBytes = 12 * 1024 * 1024, json = true } = {}) {
    const endpoint = new URL(url);
    if (endpoint.protocol !== 'https:') throw new Error('Only HTTPS sources are supported');
    const host = endpoint.host;
    for (let attempt = 0; attempt < 4; attempt++) {
      this.signal?.throwIfAborted();
      await this.wait((this.next.get(host) || 0) - this.clock());
      this.next.set(host, this.clock() + interval);
      const timeout = AbortSignal.timeout(45_000);
      const response = await this.fetcher(url, {
        headers: { 'User-Agent': 'MaineSource/0.1 (dataset collection; https://github.com/Lithium357/Maine-Source)', Accept: json ? 'application/json' : '*/*', ...headers },
        signal: this.signal ? AbortSignal.any([this.signal, timeout]) : timeout,
        redirect: 'error',
      });
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
      if (Number(response.headers.get('content-length')) > maxBytes) { await response.body?.cancel(); throw new Error(`${host}: response exceeds safety size limit`); }
      const chunks = []; let bytes = 0;
      for await (const chunk of response.body) {
        this.signal?.throwIfAborted();
        bytes += chunk.length;
        if (bytes > maxBytes) throw new Error(`${host}: response exceeds safety size limit`);
        chunks.push(chunk);
      }
      const text = Buffer.concat(chunks).toString('utf8');
      return json ? JSON.parse(text) : text;
    }
  }
}
