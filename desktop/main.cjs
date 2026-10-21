const { app, BrowserWindow, ipcMain, dialog, safeStorage, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');

let window, collector, state, catalog, policy, atomicJSON, storage;
let keys = {}, storedKeys = {}, localPaths = [], closing = false;
const uiFile = path.join(__dirname, '..', 'ui', 'index.html');
const statePath = () => path.join(app.getPath('userData'), 'preferences.json');
const vaultPath = () => path.join(app.getPath('userData'), 'credentials.json');
const respond = fn => async (event, ...args) => {
  if (event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== pathToFileURL(uiFile).href) throw new Error('Untrusted IPC sender');
  try { return { ok: true, value: await fn(...args) }; } catch (error) { return { ok: false, error: error.message || 'Operation failed' }; }
};
const snapshot = () => ({ ...state, jobs: collector.jobs, sourceCatalog: catalog.sources, presets: catalog.presets, widgetCatalog: catalog.widgets, licenseIds: policy.licenseIds, licenseLevels: policy.levels, credentialStatus: Object.fromEntries(catalog.sources.filter(s => s.key).map(s => [s.id, Boolean(keys[s.id])])), secureStorage: safeStorage.isEncryptionAvailable(), localFiles: localPaths.map(p => path.basename(p)), dataPath: storage.data, version: app.getVersion() });
const emit = () => { if (window && !window.isDestroyed()) window.webContents.send('state:changed', snapshot()); };
const save = () => atomicJSON(statePath(), state);

app.whenReady().then(async () => {
  const engine = await import('../src/engine.mjs');
  catalog = await import('../src/catalog.mjs');
  policy = await import('../src/policy.mjs');
  atomicJSON = engine.atomicJSON;
  const { prepareStorage } = await import('../src/storage.mjs');
  storage = await prepareStorage({ desktop: app.getPath('desktop'), userData: app.getPath('userData') });
  state = { selectedSources: [], recipes: [], dashboard: catalog.widgets.map(w => w.id), onboardingDone: false };
  try { state = { ...state, ...JSON.parse(await fs.readFile(statePath(), 'utf8')) }; } catch (e) { if (e.code !== 'ENOENT') await dialog.showMessageBox({ type: 'warning', message: 'Preferences could not be loaded. Defaults will be used.' }); }
  try { storedKeys = JSON.parse(await fs.readFile(vaultPath(), 'utf8')); } catch {}
  if (safeStorage.isEncryptionAvailable()) for (const [id, encrypted] of Object.entries(storedKeys)) { try { keys[id] = safeStorage.decryptString(Buffer.from(encrypted, 'base64')); } catch {} }
  collector = new engine.Collector({ root: storage.datasets, getKey: id => keys[id] || '', onChange: emit });
  await collector.init();
  window = new BrowserWindow({ width: 1440, height: 960, minWidth: 1000, minHeight: 720, backgroundColor: '#f5f7f8', title: 'Maine Source', icon: path.join(__dirname, '..', 'assets', 'icon.png'), autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  window.webContents.session.setPermissionCheckHandler(() => false);
  ipcMain.handle('state:get', respond(snapshot));
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
  ipcMain.handle('local:pick', respond(async () => {
    const choice = await dialog.showOpenDialog(window, { title: 'Choose text, code, or JSONL files', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Text and code', extensions: ['jsonl', 'txt', 'md', 'py', 'js', 'ts', 'tsx', 'rs', 'go', 'c', 'cpp', 'h', 'java', 'html', 'xml', 'csv'] }, { name: 'All files', extensions: ['*'] }] });
    if (!choice.canceled) { localPaths = choice.filePaths; collector.localPaths = localPaths; emit(); }
  }));
  ipcMain.handle('job:start', respond(recipe => collector.start(recipe)));
  ipcMain.handle('job:pause', respond(() => collector.pause()));
  ipcMain.handle('job:stop', respond(() => collector.stop()));
  ipcMain.handle('dataset:export', respond(async ({ id, format }) => {
    const job = collector.jobs.find(j => j.id === id); if (!job) throw new Error('Dataset not found');
    const choice = await dialog.showSaveDialog(window, { title: 'Export dataset', defaultPath: path.join(storage.exports, `${job.name.replace(/[^\w-]+/g, '-')}.${format === 'text' ? 'txt' : 'jsonl'}`), filters: [{ name: format === 'text' ? 'Plain text' : 'JSON Lines', extensions: [format === 'text' ? 'txt' : 'jsonl'] }] });
    if (!choice.canceled) { await collector.exportTo(id, choice.filePath, format); return 'Dataset and companion manifest exported.'; }
    return 'Export canceled.';
  }));
  ipcMain.handle('link:open', respond(async address => {
    const url = new URL(address); if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Only HTTPS links may be opened');
    await shell.openExternal(url.href);
  }));
  ipcMain.handle('data:open', respond(async () => { const error = await shell.openPath(storage.data); if (error) throw new Error(error); }));
  await window.loadFile(uiFile);
  window.on('close', async event => {
    if (closing) return;
    event.preventDefault(); closing = true; collector.stop();
    try { await collector.running; await collector.pendingSave; } finally { window.destroy(); app.quit(); }
  });
}).catch(async error => { await dialog.showMessageBox({ type: 'error', title: 'Maine Source could not start', message: error.message }); app.quit(); });
app.on('window-all-closed', () => app.quit());
