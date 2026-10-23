const { contextBridge, ipcRenderer } = require('electron');
const channels = new Set(['state:get', 'output:save', 'sources:save', 'dashboard:save', 'recipe:save', 'recipe:delete', 'credential:import', 'credential:export', 'credential:save', 'credential:test', 'local:pick', 'job:start', 'job:resume', 'storage:space', 'storage:choose', 'download:choose', 'dataset:move', 'dataset:open', 'dataset:browse', 'dataset:record', 'dataset:validate', 'dataset:delete', 'job:pause', 'job:stop', 'dataset:export', 'attachment:show', 'link:open', 'data:open']);
contextBridge.exposeInMainWorld('maine', {
  call: async (channel, payload) => {
    if (!channels.has(channel)) throw new Error('Unknown action');
    const result = await ipcRenderer.invoke(channel, payload);
    if (!result.ok) throw new Error(result.error);
    return result.value;
  },
  subscribe: listener => { const handler = (_event, value) => listener(value); ipcRenderer.on('state:changed', handler); return () => ipcRenderer.removeListener('state:changed', handler); },
});
