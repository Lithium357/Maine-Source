// Development-only UI adapter. The packaged app excludes this file.
import { sources, presets, widgets, defaultRecipe } from '../src/catalog.mjs';
const levels = ['Allow unknown evidence.', 'Exclude conflicts.', 'Require inferred evidence.', 'Require a declaration.', 'Require a declaration and URL.', 'Require scoped evidence.', 'Require record evidence.', 'Require a version.', 'Require a content notice.', 'Require corroborated evidence.'];
const now = Date.now();
const recipe = { ...defaultRecipe(), id: 'preview-recipe', name: 'Engineering knowledge base', sourceIds: ['github', 'nvd', 'stackexchange'], strictness: 6 };
const state = { preview: true, selectedSources: ['nvd', 'cisa', 'github', 'stackexchange', 'nasa', 'wikipedia'], recipes: [recipe], dashboard: widgets.map(w => w.id), sourceCatalog: sources, presets, widgetCatalog: widgets, licenseIds: ['CC0-1.0', 'MIT', 'Apache-2.0', 'CC-BY-4.0', 'CC-BY-SA-4.0', 'GPL-3.0-only'], licenseLevels: levels, credentialStatus: { github: true, nasa: true }, secureStorage: false, localFiles: [], dataPath: 'Development preview — no actual collection', jobs: [
  { id: 'preview-1', name: 'Engineering knowledge base', recipe, status: 'completed', startedAt: new Date(now - 3600000).toISOString(), endedAt: new Date(now - 1800000).toISOString(), accepted: 1248, rejected: 183, bytes: 18450000, seen: 1431, errors: 0, counts: { github: 824, stackexchange: 310, nvd: 114 }, licenses: { MIT: 654, 'Apache-2.0': 170, 'CC-BY-SA-4.0': 310, Unknown: 114 }, outcomes: { keyword: 67, license: 81, duplicate: 30, empty: 5 }, reason: 'Document count limit reached', samples: [], events: [{ time: new Date(now - 1800000).toISOString(), kind: 'info', message: 'Simulated collection finished at its configured document limit.' }, { time: new Date(now - 1900000).toISOString(), kind: 'accepted', message: 'Simulated record: memory-safe parsing patterns', source: 'github' }], activity: Array.from({ length: 14 }, (_, i) => ({ bucket: new Date(now - (13 - i) * 86400000).toISOString().slice(0, 16), count: [12, 27, 19, 63, 47, 71, 53, 96, 84, 130, 106, 152, 174, 214][i] })) },
  { id: 'preview-2', name: 'Orbital mechanics notes', recipe: { ...recipe, name: 'Orbital mechanics notes', sourceIds: ['nasa', 'wikipedia'] }, status: 'completed', startedAt: new Date(now - 86400000).toISOString(), accepted: 218, rejected: 12, bytes: 2450000, seen: 230, errors: 0, counts: { nasa: 72, wikipedia: 146 }, licenses: { Unknown: 72, 'CC-BY-SA-4.0': 146 }, outcomes: { keyword: 5, license: 7 }, reason: 'All selected sources exhausted', samples: [], events: [], activity: [] },
] };
const listeners = new Set();
const emit = () => listeners.forEach(fn => fn(structuredClone(state)));
export const previewAPI = {
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  async call(channel, payload) {
    if (channel === 'state:get') return structuredClone(state);
    if (channel === 'dashboard:save') state.dashboard = payload;
    else if (channel === 'output:save') state.textOutput = payload;
    else if (channel === 'sources:save') state.selectedSources = payload;
    else if (channel === 'recipe:save') { const recipe = { ...payload, id: payload.id || crypto.randomUUID() }; state.recipes = [recipe, ...state.recipes.filter(r => r.id !== recipe.id)]; emit(); return recipe.id; }
    else if (channel === 'recipe:delete') state.recipes = state.recipes.filter(r => r.id !== payload);
    else if (channel === 'link:open') { window.open(payload, '_blank', 'noopener'); return; }
    else throw new Error('This is a UI preview. Collection, file access, and credentials are available only in the desktop app.');
    emit();
  },
};
