import path from 'node:path';
import { mkdir, stat, lstat, cp, rename, statfs, readdir, realpath } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

async function exists(directory) {
  try { await stat(directory); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

export function storagePaths({ desktop, userData, dataDirectory }) {
  if (!path.isAbsolute(desktop) || !path.isAbsolute(userData)) throw new Error('Desktop and application storage paths must be absolute');
  if (dataDirectory && !path.isAbsolute(dataDirectory)) throw new Error('Data directory must be absolute');
  const data = dataDirectory || path.join(desktop, 'data', 'Maine-Source');
  return { data, datasets: path.join(data, 'datasets'), exports: path.join(data, 'exports'), legacyDatasets: path.join(userData, 'datasets') };
}

export async function prepareStorage(locations) {
  const paths = storagePaths(locations);
  await mkdir(paths.data, { recursive: true });
  // The old copy stays intact. Stage the complete copy before making it active.
  // An existing Desktop dataset directory always takes precedence over legacy data.
  if (!await exists(paths.datasets) && await exists(paths.legacyDatasets)) {
    const staging = path.join(paths.data, `.legacy-import-${randomUUID()}`);
    await cp(paths.legacyDatasets, staging, { recursive: true, force: false, errorOnExist: true });
    await rename(staging, paths.datasets);
  }
  await mkdir(paths.datasets, { recursive: true });
  await mkdir(paths.exports, { recursive: true });
  return paths;
}

export async function ensureFreeSpace(directory, required = 0, reserve = 64 * 1024 * 1024) {
  const info = await statfs(directory, { bigint: true });
  const available = info.bavail * info.bsize;
  if (available < BigInt(Math.ceil(required + reserve))) throw new Error('Not enough free disk space. Free space or move storage in Settings, then resume the collection.');
  return Number(available);
}
export async function relocateStorage(paths, parent) {
  if (!path.isAbsolute(parent)) throw new Error('Choose an absolute storage folder');
  const source = await realpath(paths.data), destination = path.join(await realpath(parent), 'Maine-Source');
  const relation = path.relative(source, destination);
  if (!relation || !relation.startsWith('..') && !path.isAbsolute(relation)) throw new Error('Choose a folder outside the current data folder');
  if (await exists(destination)) throw new Error('The destination already contains a Maine-Source folder. Choose an empty location to avoid overwriting data.');
  let bytes = 0;
  async function count(directory) { for (const entry of await readdir(directory, { withFileTypes: true })) { if (entry.isSymbolicLink()) throw new Error('Storage contains a symbolic link; relocation stopped'); const file = path.join(directory, entry.name); if (entry.isDirectory()) await count(file); else bytes += (await stat(file)).size; } }
  await count(source); await ensureFreeSpace(parent, bytes);
  const staging = path.join(parent, `.maine-source-move-${randomUUID()}`);
  await cp(source, staging, { recursive: true, force: false, errorOnExist: true });
  await rename(staging, destination);
  return { ...paths, data: destination, datasets: path.join(destination, 'datasets'), exports: path.join(destination, 'exports') };
}

export async function relocateDataset(sourceDirectory, parent, id, checkSpace = ensureFreeSpace) {
  if (!path.isAbsolute(parent) || !/^[a-zA-Z0-9_-]{1,80}$/.test(id)) throw new Error('Choose an absolute dataset folder');
  if ((await lstat(sourceDirectory)).isSymbolicLink()) throw new Error('Cannot move a linked dataset');
  const source = await realpath(sourceDirectory), storageParent = await realpath(parent), destination = path.join(storageParent, id);
  const relative = path.relative(source, destination);
  if (!relative || !relative.startsWith('..') && !path.isAbsolute(relative)) throw new Error('Choose a folder outside the current dataset');
  if (await exists(destination)) throw new Error('Destination already contains this dataset. Choose another folder; existing files will not be overwritten.');
  const files = []; let bytes = 0;
  async function inspect(directory, prefix = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error('Dataset contains a filesystem link; copy stopped');
      const name = path.join(prefix, entry.name), filename = path.join(source, name);
      if (entry.isDirectory()) await inspect(filename, name);
      else if (entry.isFile()) { files.push(name); bytes += (await stat(filename)).size; }
      else throw new Error('Dataset contains an unsupported file type');
    }
  }
  await inspect(source); await checkSpace(storageParent, bytes);
  const staging = path.join(storageParent, `.maine-source-dataset-${randomUUID()}`);
  // Keep the old location intact until the complete verified copy is selected.
  await cp(source, staging, { recursive: true, force: false, errorOnExist: true, filter: async filename => {
    if ((await lstat(filename)).isSymbolicLink()) throw new Error('Dataset contains a filesystem link; copy stopped');
    return true;
  } });
  const hash = async filename => { const digest = createHash('sha256'); for await (const part of createReadStream(filename)) digest.update(part); return digest.digest('hex'); };
  for (const file of files) if (await hash(path.join(source, file)) !== await hash(path.join(staging, file))) throw new Error('Dataset copy verification failed; original folder remains active');
  await rename(staging, destination);
  return { storageParent, destination };
}
