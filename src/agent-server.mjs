import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { Collector } from './engine.mjs';
import { defaultRecipe, sources } from './catalog.mjs';
import * as datasets from './datasets.mjs';
import { parseCredentials } from './credentials.mjs';
import { redactSecrets } from './http.mjs';
import { acquireWorkspace } from './workspace-lock.mjs';

export async function serveAgent({ workspace, input = process.stdin, output = process.stdout }) {
  if (!workspace || !path.isAbsolute(workspace)) throw new Error('Headless workspace must be absolute');
  const root = path.join(workspace, 'datasets'), lease = await acquireWorkspace(root);
  let keys = {}, shuttingDown = false;
  const collector = new Collector({ root, getKey: id => keys[id] || '' });
  const job = id => { const found = collector.jobs.find(j => j.id === id); if (!found) throw new Error('Dataset not found'); return { ...found, directory: path.join(found.storageParent || root, found.id) }; };
  const absolute = value => { if (typeof value !== 'string' || !path.isAbsolute(value)) throw new Error('Use an absolute file or folder path'); return value; };
  const idle = () => { if (collector.active || collector.starting) throw new Error('Stop collection before this operation'); };
  const dispatch = async (method, p) => {
    switch (method) {
      case 'ping': return { protocol: 'maine-source.agent.v1', workspace };
      case 'sources': return sources.filter(s => !s.planned);
      case 'recipe:default': return defaultRecipe();
      case 'credentials:set': idle(); keys = { ...keys, ...parseCredentials(p.keys) }; return { configured: Object.keys(keys) };
      case 'dataset:list': return collector.jobs.map(j => job(j.id));
      case 'dataset:get': return job(p.id);
      case 'dataset:start': {
        idle(); const recipe = { ...defaultRecipe(), ...p.recipe };
        const allowed = new Set([...Object.keys(defaultRecipe()), 'id', 'downloadDirectory']);
        if (Object.keys(recipe).some(k => !allowed.has(k))) throw new Error('Unknown recipe field; send credentials separately');
        if (p.localFiles !== undefined && (!Array.isArray(p.localFiles) || p.localFiles.some(f => typeof f !== 'string' || !path.isAbsolute(f)))) throw new Error('Local files must be absolute paths');
        collector.localPaths = p.localFiles || [];
        return { id: await collector.start(recipe) };
      }
      case 'dataset:pause': {
        if (collector.active?.job.id !== p.id) throw new Error('This dataset is not active');
        if (!collector.active.paused) collector.pause(); await collector.pendingSave; return job(p.id);
      }
      case 'dataset:resume': {
        if (p.localFiles !== undefined) { if (!Array.isArray(p.localFiles)) throw new Error('Local files must be absolute paths'); collector.localPaths = p.localFiles.map(absolute); }
        await collector.resume(p.id, p.limits); return job(p.id);
      }
      case 'dataset:stop': {
        if (collector.active?.job.id !== p.id) throw new Error('This dataset is not active');
        collector.stop(); await collector.running; return job(p.id);
      }
      case 'dataset:browse': return datasets.browseRecords(await collector.folder(p.id), p.options);
      case 'dataset:record': return datasets.recordDetail(await collector.folder(p.id), p.file, p.offset);
      case 'dataset:validate': return datasets.validateDataset(await collector.folder(p.id));
      case 'dataset:move': return { directory: await collector.moveDataset(p.id, absolute(p.parent)) };
      case 'dataset:export': await collector.exportTo(p.id, absolute(p.destination), p.format, p.textOutput); return { destination: p.destination };
      case 'shutdown': shuttingDown = true; collector.stop(); await collector.running; return { stopped: true };
      default: throw new Error('Unknown agent API method');
    }
  };
  let lines;
  try {
    await mkdir(path.join(workspace, 'exports'), { recursive: true }); await collector.init();
    lines = createInterface({ input, crlfDelay: Infinity });
    for await (const line of lines) {
      let request;
      try {
        if (Buffer.byteLength(line) > 1048576) throw new Error('Agent request exceeds 1 MiB');
        try { request = JSON.parse(line); } catch { throw new Error('Invalid agent request JSON'); }
        if (!Number.isSafeInteger(request?.id) || typeof request.method !== 'string' || request.params !== undefined && (!request.params || typeof request.params !== 'object' || Array.isArray(request.params))) throw new Error('Invalid agent request');
        const result = await dispatch(request.method, request.params || {});
        output.write(JSON.stringify({ id: request.id, result }) + '\n');
      } catch (error) {
        output.write(JSON.stringify({ id: Number.isSafeInteger(request?.id) ? request.id : null, error: { message: redactSecrets(error.message, Object.values(keys)) } }) + '\n');
      }
      if (shuttingDown) break;
    }
  } finally {
    lines?.close(); collector.stop(); await collector.running; await collector.pendingSave; keys = {}; await lease.release();
  }
}
