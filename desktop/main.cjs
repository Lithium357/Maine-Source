const { app, BrowserWindow, ipcMain, dialog, safeStorage, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');

let window, collector, state, catalog, policy, atomicJSON, storage, output, engine, datasets, storageTools;
let workspaceBusy = false;
let workspaceLease;
let keys = {}, storedKeys = {}, localPaths = [], closing = false;
const uiFile = path.join(__dirname, '..', 'ui', 'index.html');
const statePath = () => path.join(app.getPath('userData'), 'preferences.json');
const vaultPath = () => path.join(app.getPath('userData'), 'credentials.json');
const respond = fn => async (event, ...args) => {
  if (event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== pathToFileURL(uiFile).href) throw new Error('Untrusted IPC sender');
  try { return { ok: true, value: await fn(...args) }; } catch (error) { return { ok: false, error: error.message || 'Operation failed' }; }
};
const snapshot = () => ({ ...state, jobs: collector.jobs.map(job => ({ ...job, directory: path.join(job.storageParent || storage.datasets, job.id) })), sourceCatalog: catalog.sources, presets: catalog.presets, widgetCatalog: catalog.widgets, licenseIds: policy.licenseIds, licenseLevels: policy.levels, credentialStatus: Object.fromEntries(catalog.sources.filter(s => s.key).map(s => [s.id, Boolean(keys[s.id])])), secureStorage: safeStorage.isEncryptionAvailable(), localFiles: localPaths.map(p => path.basename(p)), dataPath: storage.data, workspaceBusy, version: app.getVersion() });
const emit = () => { if (window && !window.isDestroyed()) window.webContents.send('state:changed', snapshot()); };
const save = () => atomicJSON(statePath(), state);
async function workspaceOperation(fn) {
  if (workspaceBusy || collector?.starting) throw new Error('Wait for the current workspace operation to finish');
  workspaceBusy = true; emit();
  try { return await fn(); } finally { workspaceBusy = false; emit(); }
}

const selfTestAt = process.argv.indexOf('--self-test');
if (selfTestAt >= 0) {
  const parent = process.argv[selfTestAt + 1];
  if (!parent || !path.isAbsolute(parent)) throw new Error('Self-test requires an absolute temporary parent folder');
  const profile = path.join(parent, 'diagnostic-profile'); require('node:fs').mkdirSync(profile, { recursive: true }); app.setPath('userData', profile);
  app.whenReady().then(() => require('./self-test.cjs').run(process.argv[selfTestAt + 1])).then(() => app.exit(0)).catch(error => { process.stderr.write(error.stack || error.message); app.exit(1); });
} else if (!app.requestSingleInstanceLock()) app.quit();
else app.whenReady().then(async () => {
  engine = await import('../src/engine.mjs');
  datasets = await import('../src/datasets.mjs');
  storageTools = await import('../src/storage.mjs');
  catalog = await import('../src/catalog.mjs');
  policy = await import('../src/policy.mjs');
  output = await import('../src/output-options.mjs');
  atomicJSON = engine.atomicJSON;
  state = { selectedSources: [], recipes: [], dashboard: catalog.widgets.map(w => w.id), onboardingDone: false };
  try { state = { ...state, ...JSON.parse(await fs.readFile(statePath(), 'utf8')) }; } catch (e) { if (e.code !== 'ENOENT') await dialog.showMessageBox({ type: 'warning', message: 'Preferences could not be loaded. Defaults will be used.' }); }
  storage = await storageTools.prepareStorage({ desktop: app.getPath('desktop'), userData: app.getPath('userData'), dataDirectory: state.dataDirectory });
  workspaceLease = await (await import('../src/workspace-lock.mjs')).acquireWorkspace(storage.datasets);
  try { storedKeys = JSON.parse(await fs.readFile(vaultPath(), 'utf8')); } catch {}
  try { state.textOutput = output.validateTextOutput(state.textOutput); } catch { state.textOutput = output.defaultTextOutput(); }
  if (safeStorage.isEncryptionAvailable()) for (const [id, encrypted] of Object.entries(storedKeys)) { try { keys[id] = safeStorage.decryptString(Buffer.from(encrypted, 'base64')); } catch {} }
  collector = new engine.Collector({ root: storage.datasets, getKey: id => keys[id] || '', onChange: emit });
  await collector.init();
  window = new BrowserWindow({ width: 1440, height: 960, minWidth: 1000, minHeight: 720, backgroundColor: '#f5f7f8', title: 'Maine Source', icon: path.join(__dirname, '..', 'assets', 'icon.png'), autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  window.webContents.session.setPermissionCheckHandler(() => false);
  ipcMain.handle('state:get', respond(snapshot));
  ipcMain.handle('output:save', respond(async preferences => {
    state.textOutput = output.validateTextOutput(preferences); await save(); emit();
  }));
  ipcMain.handle('sources:save', respond(async ids => {
    if (!Array.isArray(ids) || ids.some(id => !catalog.sources.some(s => s.id === id && !s.planned))) throw new Error('Invalid source selection');
    state.selectedSources = [...new Set(ids)]; state.onboardingDone = true; await save(); emit();
  }));
  ipcMain.handle('dashboard:save', respond(async ids => {
    if (!Array.isArray(ids) || ids.some(id => !catalog.widgets.some(w => w.id === id)) || new Set(ids).size !== ids.length) throw new Error('Invalid dashboard layout');
    state.dashboard = ids; await save(); emit();
  }));
  ipcMain.handle('recipe:save', respond(async recipe => {
    const validated = engine.validateRecipe(recipe);
    validated.id = recipe.id && state.recipes.some(r => r.id === recipe.id) ? recipe.id : require('node:crypto').randomUUID();
    state.recipes = [validated, ...state.recipes.filter(r => r.id !== validated.id)]; await save(); emit(); return validated.id;
  }));
  ipcMain.handle('recipe:delete', respond(async id => { state.recipes = state.recipes.filter(r => r.id !== id); await save(); emit(); }));
  ipcMain.handle('credential:save', respond(async ({ id, key, persist }) => {
    if (!catalog.sources.some(s => s.id === id && s.key) || typeof key !== 'string' || key.length > 4096) throw new Error('Invalid credential');
    if (persist && key && !safeStorage.isEncryptionAvailable()) throw new Error('Encrypted storage is unavailable. Use session-only credentials.');
    if (key) keys[id] = key.trim(); else delete keys[id];
    delete storedKeys[id];
    if (persist && keys[id]) storedKeys[id] = safeStorage.encryptString(keys[id]).toString('base64');
    await atomicJSON(vaultPath(), storedKeys); emit();
  }));
  ipcMain.handle('credential:import', respond(() => workspaceOperation(async () => {
    if (collector.active) throw new Error('Stop collection before importing credentials');
    const selected = await dialog.showOpenDialog(window, { title: 'Import API keys from JSON', properties: ['openFile'], filters: [{ name: 'Credential JSON', extensions: ['json'] }] });
    if (selected.canceled) return 'Import canceled.';
    const imported = await (await import('../src/credentials.mjs')).readCredentialFile(selected.filePaths[0]);
    const ids = Object.keys(imported), secure = safeStorage.isEncryptionAvailable();
    const choice = await dialog.showMessageBox(window, { type: 'question', title: 'Import API keys', message: `Import ${ids.length} credentials?`, detail: `${ids.map(id => catalog.sources.find(s => s.id === id).name).join(', ')}. Existing keys for these sources will be replaced; other sources are kept.`, buttons: secure ? ['Cancel', 'This session only', 'Remember encrypted'] : ['Cancel', 'This session only'], defaultId: 1, cancelId: 0, noLink: true });
    if (choice.response === 0) return 'Import canceled.';
    const nextStored = { ...storedKeys };
    for (const id of ids) { delete nextStored[id]; if (secure && choice.response === 2) nextStored[id] = safeStorage.encryptString(imported[id]).toString('base64'); }
    await atomicJSON(vaultPath(), nextStored);
    storedKeys = nextStored; keys = { ...keys, ...imported }; emit();
    return `${ids.length} credentials imported${choice.response === 2 ? ' and remembered using encrypted system storage' : ' for this session'}.`;
  })));
  ipcMain.handle('credential:export', respond(() => workspaceOperation(async () => {
    const bundle = (await import('../src/credentials.mjs')).credentialBundle(keys);
    const choice = await dialog.showSaveDialog(window, { title: 'Export plaintext API keys — protect this file', defaultPath: 'maine-source-keys.json', filters: [{ name: 'Plaintext credential JSON', extensions: ['json'] }] });
    if (choice.canceled) return 'Export canceled.';
    await atomicJSON(choice.filePath, bundle);
    return 'API keys exported as plaintext JSON. Keep this file private when transferring it.';
  })));
  const connectionChecks = new Set();
  ipcMain.handle('credential:test', respond(async ({ id }) => {
    if (!catalog.sources.some(s => s.id === id && s.key)) throw new Error('Invalid source');
    if (collector.active || collector.starting) throw new Error('Stop collection before testing connections');
    if (connectionChecks.size) throw new Error('Wait for the current connection test');
    const key = keys[id];
    connectionChecks.add(id);
    try { return await (await import('../src/connection-check.mjs')).checkConnection(id, key); }
    finally { connectionChecks.delete(id); }
  }));
  ipcMain.handle('local:pick', respond(async () => {
    const choice = await dialog.showOpenDialog(window, { title: 'Choose text, code, or JSONL files', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Text and code', extensions: ['jsonl', 'txt', 'md', 'py', 'js', 'ts', 'tsx', 'rs', 'go', 'c', 'cpp', 'h', 'java', 'html', 'xml', 'csv'] }, { name: 'All files', extensions: ['*'] }] });
    if (!choice.canceled) { localPaths = choice.filePaths; collector.localPaths = localPaths; emit(); }
  }));
  ipcMain.handle('job:start', respond(recipe => { if (workspaceBusy) throw new Error('Wait for the current workspace operation'); return collector.start(recipe); }));
  ipcMain.handle('job:resume', respond(({ id, limits }) => { if (workspaceBusy) throw new Error('Wait for the current workspace operation'); return collector.resume(id, limits); }));
  ipcMain.handle('job:pause', respond(() => collector.pause()));
  ipcMain.handle('job:stop', respond(() => collector.stop()));
  ipcMain.handle('dataset:export', respond(async ({ id, format }) => workspaceOperation(async () => {
    const job = collector.jobs.find(j => j.id === id); if (!job) throw new Error('Dataset not found');
    const extension = format === 'text' ? output.textExportExtension(state.textOutput) : 'jsonl';
    const choice = await dialog.showSaveDialog(window, { title: 'Export dataset', defaultPath: path.join(storage.exports, `${job.name.replace(/[^\w-]+/g, '-')}.${extension}`), filters: [{ name: format === 'text' ? 'Configured text output' : 'JSON Lines', extensions: [extension.split('.').at(-1)] }] });
    if (!choice.canceled) { await collector.exportTo(id, choice.filePath, format, state.textOutput); return 'Dataset, original files, and companion manifest exported.'; }
    return 'Export canceled.';
  })));
  const folder = id => collector.folder(id);
  ipcMain.handle('download:choose', respond(async () => {
    const choice = await dialog.showOpenDialog(window, { title: 'Choose a download folder for this recipe', properties: ['openDirectory', 'createDirectory'] });
    return choice.canceled ? null : choice.filePaths[0];
  }));
  ipcMain.handle('dataset:open', respond(async ({ id }) => {
    const error = await shell.openPath(await folder(id)); if (error) throw new Error(error);
  }));
  ipcMain.handle('dataset:move', respond(({ id }) => workspaceOperation(async () => {
    if (collector.active) throw new Error('Stop collection before changing a dataset folder');
    await folder(id);
    const choice = await dialog.showOpenDialog(window, { title: 'Choose a new parent folder for this dataset', properties: ['openDirectory', 'createDirectory'] });
    if (choice.canceled) return 'Dataset folder unchanged.';
    const destination = await collector.moveDataset(id, choice.filePaths[0]);
    return `Dataset copied, verified, and switched to ${destination}. The previous folder is kept as a backup.`;
  })));
  ipcMain.handle('dataset:browse', respond(async ({ id, ...options }) => datasets.browseRecords(await folder(id), options)));
  ipcMain.handle('dataset:record', respond(async ({ id, file, offset }) => datasets.recordDetail(await folder(id), file, offset)));
  ipcMain.handle('dataset:validate', respond(({ id }) => workspaceOperation(async () => datasets.validateDataset(await folder(id)))));
  ipcMain.handle('dataset:delete', respond(({ id }) => workspaceOperation(async () => {
    if (collector.active) throw new Error('Stop collection before deleting a dataset');
    const target = await folder(id), job = collector.jobs.find(j => j.id === id);
    if ((await fs.lstat(target)).isSymbolicLink()) throw new Error('Cannot delete a linked dataset folder');
    const choice = await dialog.showMessageBox(window, { type: 'warning', title: 'Move dataset to Recycle Bin?', message: `Move “${job.name}” and its original files to the Recycle Bin?`, detail: 'Existing exports are kept. This removes the collection from the app.', buttons: ['Cancel', 'Move to Recycle Bin'], defaultId: 0, cancelId: 0, noLink: true });
    if (choice.response !== 1) return false;
    await shell.trashItem(target); collector.jobs = collector.jobs.filter(j => j.id !== id); await collector.save(); emit(); return true;
  })));
  ipcMain.handle('storage:space', respond(async () => storageTools.ensureFreeSpace(storage.data, 0, 0)));
  ipcMain.handle('storage:choose', respond(() => workspaceOperation(async () => {
    if (collector.active) throw new Error('Stop collection before moving storage');
    const choice = await dialog.showOpenDialog(window, { title: 'Choose a parent folder for Maine-Source data', properties: ['openDirectory', 'createDirectory'] });
    if (choice.canceled) return 'Storage unchanged.';
    await collector.pendingSave;
    const next = await storageTools.relocateStorage(storage, choice.filePaths[0]);
    const nextLease = await (await import('../src/workspace-lock.mjs')).acquireWorkspace(next.datasets);
    const previous = state.dataDirectory; state.dataDirectory = next.data;
    try { await save(); } catch (error) { state.dataDirectory = previous; await nextLease.release(); throw error; }
    await workspaceLease.release(); workspaceLease = nextLease;
    storage = next; collector.root = storage.datasets; emit();
    return 'Storage copied and switched. The previous folder is kept as a backup.';
  })));
  ipcMain.handle('link:open', respond(async address => {
    const url = new URL(address); if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Only HTTPS links may be opened');
    await shell.openExternal(url.href);
  }));
  ipcMain.handle('attachment:show', respond(async ({ id, relative }) => {
    if (!collector.jobs.some(job => job.id === id) || typeof relative !== 'string' || !/^assets\/[0-9]{8}\/[a-zA-Z0-9._-]+$/.test(relative)) throw new Error('Invalid original-file reference');
    const file = await datasets.containedFile(await folder(id), relative);
    await fs.access(file);
    shell.showItemInFolder(file); // Reveal only; never execute downloaded files.
  }));
  ipcMain.handle('data:open', respond(async () => { const error = await shell.openPath(storage.data); if (error) throw new Error(error); }));
  await window.loadFile(uiFile);
  window.on('close', async event => {
    if (closing) return;
    event.preventDefault(); closing = true; collector.stop();
    try { while (workspaceBusy) await new Promise(resolve => setTimeout(resolve, 100)); await collector.running; await collector.pendingSave; } finally { await workspaceLease?.release(); window.destroy(); app.quit(); }
  });
}).catch(async error => { await workspaceLease?.release(); await dialog.showMessageBox({ type: 'error', title: 'Maine Source could not start', message: error.message }); app.quit(); });
app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.focus(); } });
app.on('window-all-closed', () => app.quit());
