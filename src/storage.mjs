import path from 'node:path';
import { mkdir, stat, cp, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

async function exists(directory) {
  try { await stat(directory); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

export function storagePaths({ desktop, userData }) {
  if (!path.isAbsolute(desktop) || !path.isAbsolute(userData)) throw new Error('Desktop and application storage paths must be absolute');
  const data = path.join(desktop, 'data', 'Maine-Source');
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
