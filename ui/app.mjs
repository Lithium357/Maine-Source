import { outputOptions, defaultTextOutput } from '../src/output-options.mjs';
import { defaultRecipe } from '../src/catalog.mjs';

const icons = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  source: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v7c0 4 16 4 16 0V5M4 12v7c0 4 16 4 16 0"/>',
  sliders: '<path d="M4 7h7m5 0h4M4 17h3m5 0h8"/><circle cx="13" cy="7" r="3"/><circle cx="9" cy="17" r="3"/>',
  play: '<path d="m8 5 11 7-11 7z"/>',
  folder: '<path d="M3 7V5a2 2 0 0 1 2-2h5l3 3h6a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  gear: '<path d="m9 3-1 3-3 1 1 3-2 2 2 3-1 2 3 1 1 3h5l1-3 3-1-1-3 2-2-2-3 1-2-3-1-1-3z"/><circle cx="12" cy="12" r="3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z"/><path d="m8 12 3 3 5-6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  chart: '<path d="M4 3v18h17M8 16v-5m5 5V6m5 10V9"/>',
  file: '<path d="M14 3H5v18h14V8zM14 3v6h5M8 13h8M8 17h5"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  stop: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
  external: '<path d="M14 3h7v7m0-7L10 14M10 5H3v16h16v-7"/>',
  move: '<path d="m8 6 4-4 4 4m-4-4v20m-4-4 4 4 4-4M2 12h20m-4-4 4 4-4 4M6 8l-4 4 4 4"/>',
};
const icon = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.source}</svg>`;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const number = n => Number(n || 0).toLocaleString();
const bytes = n => n >= 1073741824 ? `${(n / 1073741824).toFixed(2)} GB` : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${number(n)} B`;
const ago = date => { const minutes = Math.floor((Date.now() - new Date(date)) / 60000); return minutes < 1 ? 'Just now' : minutes < 60 ? `${minutes}m ago` : minutes < 1440 ? `${Math.floor(minutes / 60)}h ago` : `${Math.floor(minutes / 1440)}d ago`; };
let api = window.maine;
if (!api && new URLSearchParams(location.search).has('preview')) api = (await import('./preview.mjs')).previewAPI;
let state, view = 'dashboard', search = '', category = 'All sources', selected = [], customizing = false, range = 'all', draft, dragId;
const root = document.querySelector('#app');
const modal = document.querySelector('#modal-root');
let toastTimer, browserState, browserRequest = 0;
function toast(message, error = false) { const el = document.querySelector('#toast'); el.textContent = message; el.className = `visible${error ? ' error' : ''}`; clearTimeout(toastTimer); toastTimer = setTimeout(() => el.className = '', 5000); }
async function call(channel, payload) { try { return await api.call(channel, payload); } catch (e) { toast(e.message, true); throw e; } }
const source = id => state.sourceCatalog.find(s => s.id === id);
const mark = id => { const s = source(id); return `<span class="source-mark" style="--source:${esc(s?.color || '#738c86')}">${esc(s?.mark || '??')}</span>`; };
const status = job => `<span class="status ${esc(job.status)}"><i></i>${esc(job.status.replaceAll('_', ' '))}</span>`;
function filteredJobs() { return range === 'all' ? state.jobs : state.jobs.filter(j => Date.now() - new Date(j.startedAt) <= Number(range) * 86400000); }
function totals() {
  const jobs = filteredJobs();
  const result = { accepted: 0, rejected: 0, bytes: 0, seen: 0, counts: {}, licenses: {}, outcomes: {} };
  for (const job of jobs) {
    for (const key of ['accepted', 'rejected', 'bytes', 'seen']) result[key] += job[key];
    for (const key of ['counts', 'licenses', 'outcomes']) for (const [id, count] of Object.entries(job[key] || {})) result[key][id] = (result[key][id] || 0) + count;
  }
  return result;
}
function shell() {
  const active = state.jobs.find(j => ['running', 'paused', 'stopping'].includes(j.status));
  const views = [['dashboard', 'grid', 'Overview'], ['sources', 'source', 'Sources'], ['recipes', 'sliders', 'Recipes'], ['jobs', 'play', 'Collection jobs'], ['datasets', 'folder', 'Datasets']];
  root.innerHTML = `<aside class="sidebar">
    <a class="brand" href="#" data-view="dashboard"><span class="brand-tree"><svg viewBox="0 0 36 42" aria-hidden="true"><path d="m18 2 13 17h-7l11 13H21v8h-6v-8H1l11-13H5z" fill="currentColor"/></svg></span><span>Maine<span class="brand-source">Source</span></span></a>
    <div class="workspace-label">YOUR WORKSPACE <span>LOCAL</span></div>
    <nav aria-label="Main navigation">${views.map(([id, i, label]) => `<button class="nav-item ${view === id ? 'active' : ''}" data-view="${id}">${icon(i)}<span>${label}</span>${id === 'sources' ? `<small>${state.selectedSources.length}</small>` : id === 'jobs' && active ? '<b class="live-dot"></b>' : ''}</button>`).join('')}</nav>
    <div class="sidebar-note"><span class="mini-tree">↟</span><strong>Good data starts here.</strong><p>Collect with intention.<br>Keep the source in sight.</p></div>
    <div class="sidebar-bottom"><button class="nav-item ${view === 'settings' ? 'active' : ''}" data-view="settings">${icon('gear')}<span>Connections & settings</span></button><div class="local-status"><i></i> Local workspace <span>v${esc(state.version || "0.1.1")}</span></div></div>
  </aside>
  <div class="main-shell"><header class="topbar"><div class="breadcrumbs">Workspace <span>/</span> <strong>${esc({ dashboard: 'Overview', sources: 'Sources', recipes: 'Recipes', jobs: 'Collection jobs', datasets: 'Datasets', settings: 'Connections & settings' }[view])}</strong></div><div class="topbar-right">${state.preview ? '<span class="preview-badge">UI preview · simulated data</span>' : ''}<span class="local-pill">${icon('shield')} On your machine</span><span class="avatar">MS</span></div></header><main id="main"></main><footer class="footer"><span><i></i> ${active ? `Collection ${esc(active.status)}` : 'Ready to collect'}</span><span>Your data. Your rules. Your workspace.</span></footer></div>`;
  renderContent();
}
function renderContent() {
  const main = document.querySelector('#main');
  if (!main) return;
  main.innerHTML = ({ dashboard, sources: sourcePage, recipes: recipePage, jobs: jobPage, datasets: datasetPage, settings: settingsPage }[view])();
  bindPage();
}
function refreshShellStatus() {
  const active = state.jobs.find(job => ['running', 'paused', 'stopping'].includes(job.status));
  const count = document.querySelector('.sidebar [data-view="sources"] small');
  if (count) count.textContent = state.selectedSources.length;
  const footer = document.querySelector('.footer > span:first-child');
  if (footer) footer.replaceChildren(document.createElement('i'), document.createTextNode(` ${active ? `Collection ${active.status}` : 'Ready to collect'}`));
  const jobNav = document.querySelector('.sidebar [data-view="jobs"]');
  const dot = jobNav?.querySelector('.live-dot');
  if (active && jobNav && !dot) { const indicator = document.createElement('b'); indicator.className = 'live-dot'; jobNav.append(indicator); }
  else if (!active) dot?.remove();
}
function heading(kicker, title, subtitle, actions = '') { return `<div class="page-heading"><div><p class="eyebrow">${kicker}</p><h1>${title}</h1><p class="subtitle">${subtitle}</p></div><div class="heading-actions">${actions}</div></div>`; }
function dashboard() {
  const t = totals();
  const live = state.jobs.filter(j => ['running', 'paused'].includes(j.status)).length;
  return `${heading('THE BIG PICTURE', 'Your data, taking shape.', 'A little clarity for everything you’re collecting.', `<button class="button secondary" data-action="customize">${icon('sliders')} Customize</button><button class="button primary" data-action="new-recipe">${icon('plus')} New collection</button>`)}
  ${!state.jobs.length ? `<div class="welcome-banner"><div class="welcome-icon">${icon('source')}</div><div><strong>Build a dataset that fits your world.</strong><p>Start with your sources. We’ll help you collect, filter, and keep the evidence.</p></div><button class="button secondary" data-view="sources">Choose sources ${icon('arrow')}</button></div>` : ''}
  <div class="overview-controls"><span class="section-label"><i class="live-dot"></i> WORKSPACE AT A GLANCE</span><label class="range-label">${icon('clock')}<select id="time-range" aria-label="Dashboard time range"><option value="all" ${range === 'all' ? 'selected' : ''}>All time</option><option value="7" ${range === '7' ? 'selected' : ''}>Last 7 days</option><option value="30" ${range === '30' ? 'selected' : ''}>Last 30 days</option></select></label></div>
  <div class="stats-grid">${[
    ['file', 'Documents collected', number(t.accepted), `${number(t.seen)} candidates processed`, 'datasets'],
    ['source', 'Dataset storage', bytes(t.bytes), 'Accepted records, including metadata', 'datasets'],
    ['play', 'Active collections', String(live).padStart(2, '0'), `${state.jobs.length} total collection runs`, 'jobs'],
    ['shield', 'Filtered out', number(t.rejected), t.seen ? `${Math.round(t.rejected / t.seen * 100)}% of candidates excluded` : 'Your rules apply before saving', 'recipes'],
  ].map(([i, label, value, note, target]) => `<button class="stat-card" data-view="${target}"><span class="stat-label">${label}<span class="stat-icon">${icon(i)}</span></span><strong>${value}</strong><span class="stat-note">${note}</span></button>`).join('')}</div>
  ${customizing ? `<div class="customize-banner"><div><strong>Make room for what matters.</strong><p>Drag cards to reorder, use arrow controls, or hide a widget.</p></div><button class="button secondary" data-action="widgets">Add / remove widgets</button><button class="button primary" data-action="customize">Done</button></div>` : ''}
  <div class="dashboard-grid">${state.dashboard.map(id => widget(id, t)).join('')}</div>
  ${!state.dashboard.length ? '<div class="empty"><h2>A clean canvas.</h2><p>Add widgets to build your overview.</p><button class="button secondary" data-action="widgets">Choose widgets</button></div>' : ''}`;
}
function widget(id, t) {
  const info = state.widgetCatalog.find(w => w.id === id); if (!info) return '';
  const body = ({ activity: activityWidget, sources: sourceWidget, jobs: jobsWidget, quality: qualityWidget, licenses: licenseWidget, storage: storageWidget, events: eventsWidget }[id])(t);
  return `<section class="widget ${info.size || ''} ${customizing ? 'editable' : ''}" data-widget="${id}" ${customizing ? 'draggable="true"' : ''}><div class="widget-head"><h2>${customizing ? icon('move') : ''}${info.name}</h2>${customizing ? `<div class="widget-controls"><button data-reorder="${id}" data-direction="-1" aria-label="Move ${info.name} earlier">↑</button><button data-reorder="${id}" data-direction="1" aria-label="Move ${info.name} later">↓</button><button data-hide-widget="${id}" aria-label="Hide ${info.name}">×</button></div>` : `<span class="widget-detail">${id === 'activity' ? 'Accepted documents' : id === 'jobs' ? `<button class="text-button" data-view="jobs">View all ${icon('arrow')}</button>` : icon(id === 'licenses' ? 'shield' : id === 'storage' ? 'source' : 'chart')}</span>`}</div>${body}</section>`;
}
function activityWidget() {
  const items = filteredJobs().flatMap(j => j.activity || []);
  const points = new Map(); for (const b of items) { const day = b.bucket.slice(0, 10); points.set(day, (points.get(day) || 0) + b.count); }
  const days = Array.from({ length: 14 }, (_, index) => new Date(Date.now() - (13 - index) * 86400000).toISOString().slice(0, 10));
  const values = days.map(d => points.get(d) || 0), max = Math.max(4, ...values);
  const coords = values.map((v, i) => `${44 + i * 42},${144 - v / max * 110}`);
  const line = coords.join(' ');
  return `<div class="chart-top"><span class="legend"><i></i> Accepted records</span><span class="muted">Last 14 days</span></div><div class="activity-chart"><svg viewBox="0 0 620 180" role="img" aria-label="Accepted documents per day over the past fourteen days"><defs><linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#38a58f" stop-opacity=".2"/><stop offset="1" stop-color="#38a58f" stop-opacity="0"/></linearGradient></defs>${[0, 1, 2, 3].map(i => `<line x1="40" x2="604" y1="${34 + i * 37}" y2="${34 + i * 37}" stroke="#edf0f1" stroke-dasharray="3 4"/><text x="28" y="${38 + i * 37}" text-anchor="end" fill="#8d9b9a" font-size="10">${Math.round(max * (1 - i / 3))}</text>`).join('')}<polygon points="44,145 ${line} 590,145" fill="url(#chart-fill)"/><polyline points="${line}" fill="none" stroke="#288c79" stroke-width="2.5" stroke-linejoin="round"/>${days.filter((_, i) => i % 3 === 0 || i === 13).map(d => `<text x="${44 + days.indexOf(d) * 42}" y="170" text-anchor="middle" fill="#85938e" font-size="10">${new Date(d + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</text>`).join('')}</svg></div><div class="widget-bottom"><span>${items.length ? 'Activity from your saved run history' : 'Your collection history will grow here'}</span><span class="dot-label"><i></i> Local history</span></div>`;
}
function sourceWidget(t) {
  const list = Object.entries(t.counts).sort((a, b) => b[1] - a[1]);
  return `<div class="source-list">${list.length ? list.slice(0, 5).map(([id, count]) => `<div class="source-mix-row">${mark(id)}<span><strong>${esc(source(id)?.name || id)}</strong><div class="track"><i style="width:${Math.round(count / t.accepted * 100)}%;background:${esc(source(id)?.color || '#288c79')}"></i></div></span><b>${number(count)}</b></div>`).join('') : `<div class="mini-empty">${icon('source')}<strong>A place for every source.</strong><p>Accepted data will appear here by origin.</p></div>`}</div><div class="widget-bottom"><span>${state.selectedSources.length} sources in your workspace</span><button class="text-button" data-view="sources">Manage ${icon('arrow')}</button></div>`;
}
function jobsWidget() {
  const jobs = filteredJobs().slice(0, 4);
  return jobs.length ? `<div class="table-wrap"><table><thead><tr><th>COLLECTION</th><th>STATUS</th><th>DOCUMENTS</th><th>STARTED</th></tr></thead><tbody>${jobs.map(j => `<tr><td><button class="row-link" data-job-detail="${j.id}">${esc(j.name)}</button><small>${j.recipe.sourceIds.length} sources · ${bytes(j.bytes)}</small></td><td>${status(j)}</td><td>${number(j.accepted)}</td><td class="muted">${ago(j.startedAt)}</td></tr>`).join('')}</tbody></table></div>` : `<div class="empty compact"><div class="empty-icon">${icon('play')}</div><h3>Your next collection starts here.</h3><p>Choose sources, set your rules, and let it run.</p><button class="button secondary" data-action="new-recipe">Create a collection ${icon('arrow')}</button></div>`;
}
function qualityWidget(t) {
  const rate = t.seen ? Math.round(t.accepted / t.seen * 100) : 0;
  return `<div class="quality-overview"><div class="quality-ring" style="--rate:${rate}%"><span><strong>${rate}<small>%</small></strong><em>accepted</em></span></div><div class="quality-legend">${[['Accepted', t.accepted, '#288c79'], ['Keyword / license', (t.outcomes.keyword || 0) + (t.outcomes.license || 0), '#ddaf6b'], ['Duplicates', t.outcomes.duplicate || 0, '#a3b4c4'], ['Below length', t.outcomes.empty || 0, '#d9dfe1']].map(([label, value, color]) => `<div><i style="background:${color}"></i><span>${label}</span><b>${number(value)}</b></div>`).join('')}</div></div><div class="widget-bottom"><span>Filtered records stay out of your dataset</span></div>`;
}
function licenseWidget(t) {
  const entries = Object.entries(t.licenses).sort((a, b) => b[1] - a[1]);
  return `<div class="license-list">${entries.length ? entries.slice(0, 5).map(([id, n]) => `<div class="license-row"><span>${icon('shield')} ${esc(id)}</span><b>${number(n)}</b></div>`).join('') : `<div class="mini-empty">${icon('shield')}<strong>Keep the evidence attached.</strong><p>License declarations from accepted records appear here.</p></div>`}</div><div class="widget-bottom"><span>Declarations are retained with every record</span></div>`;
}
function storageWidget(t) {
  const job = state.jobs.find(j => ['running', 'paused'].includes(j.status)) || state.jobs[0];
  const budget = job?.recipe.limits.megabytes * 1048576;
  return `<div class="storage-summary"><div class="storage-symbol">${icon('source')}</div><strong>${bytes(t.bytes)}</strong><span>Total accepted output in selected period</span></div><div class="storage-track track"><i style="width:${budget ? Math.min(100, job.bytes / budget * 100) : 0}%"></i></div><div class="storage-label"><span>${job ? esc(job.name) : 'No collection yet'}</span><strong>${budget ? `${bytes(job.bytes)} / ${bytes(budget)}` : 'No storage budget active'}</strong></div><div class="widget-bottom"><span>Bytes include record metadata</span><button class="text-button" data-view="datasets">Explore ${icon('arrow')}</button></div>`;
}
function eventsWidget() {
  const events = filteredJobs().flatMap(j => j.events || []).sort((a, b) => b.time.localeCompare(a.time)).slice(0, 5);
  return `<div class="event-list">${events.length ? events.map(e => `<div class="event-row"><span class="event-dot ${esc(e.kind)}"></span><div><p>${esc(e.message)}</p><small>${esc(source(e.source)?.name || 'Workspace')}</small></div><time>${ago(e.time)}</time></div>`).join('') : '<div class="mini-empty"><strong>Quiet, for now.</strong><p>Source requests, filter decisions, and collection updates will appear here.</p></div>'}</div>`;
}
function sourcePage() {
  const categories = ['All sources', ...new Set(state.sourceCatalog.map(s => s.category))];
  const matches = state.sourceCatalog.filter(s => (category === 'All sources' || s.category === category) && `${s.name} ${s.category} ${s.description}`.toLowerCase().includes(search.toLowerCase()));
  return `${heading('START WITH THE SOURCE', 'A world of data. Your selection.', 'Check the sources you want in your workspace. Configure each one when you build a recipe.', `<button class="button secondary" data-action="save-sources">Save selection</button><button class="button primary" data-action="new-recipe">Create collection ${icon('arrow')}</button>`)}
    <div class="source-presets"><span>QUICK START</span>${Object.keys(state.presets).map(p => `<button class="preset" data-preset="${esc(p)}">${p === 'Cybersecurity' ? icon('shield') : icon('plus')}${esc(p)}</button>`).join('')}<small>Presets add to your selection</small></div>
    <div class="catalog-toolbar"><label class="search-field">${icon('search')}<input id="source-search" type="search" placeholder="Find a source, topic, or category…" value="${esc(search)}" aria-label="Search sources"></label><div class="selection-count"><strong>${selected.length}</strong> sources selected</div><button class="text-button" data-action="select-visible">Select available</button><button class="text-button" data-action="clear-sources">Clear all</button></div>
    <div class="source-catalog"><aside class="category-nav">${categories.map(c => `<button data-category="${esc(c)}" class="${category === c ? 'active' : ''}">${esc(c)}<span>${state.sourceCatalog.filter(s => c === 'All sources' || s.category === c).length}</span></button>`).join('')}</aside><div class="source-grid">${matches.map(s => `<label class="source-card ${selected.includes(s.id) ? 'selected' : ''} ${s.planned ? 'planned' : ''}"><div class="source-card-top">${mark(s.id)}<input type="checkbox" name="source" value="${s.id}" ${selected.includes(s.id) ? 'checked' : ''} ${s.planned ? 'disabled' : ''} aria-label="Select ${esc(s.name)}"></div><span class="source-category">${esc(s.category)}</span><h2>${esc(s.name)}</h2><p>${esc(s.description)}</p><div class="source-card-bottom"><span class="source-state">${s.planned ? 'On the roadmap' : s.key ? state.credentialStatus[s.id] ? '● Credential configured' : 'API connection' : s.id === 'local' ? 'On your machine' : 'No key needed'}</span>${s.docs ? `<button type="button" class="icon-button" data-link="${esc(s.docs)}" aria-label="Read ${esc(s.name)} documentation">${icon('external')}</button>` : ''}</div></label>`).join('')}${!matches.length ? '<div class="empty"><h3>No matching sources.</h3><p>Try a broader search or another category.</p></div>' : ''}</div></div>`;
}
function recipePage() {
  return `${heading('COLLECT WITH INTENTION', 'Your dataset recipes.', 'Save the sources, filters, and limits that make a dataset yours.', `<button class="button primary" data-action="new-recipe">${icon('plus')} New recipe</button>`)}<div class="recipe-grid">${state.recipes.map(r => `<article class="recipe-card"><div class="recipe-top"><span class="recipe-icon">${icon('sliders')}</span><span class="tag">${esc(r.licenseMode === 'off' ? 'License gate off' : `Strictness ${r.strictness} / 10`)}</span></div><h2>${esc(r.name)}</h2><div class="recipe-marks">${r.sourceIds.slice(0, 6).map(mark).join('')}<span>${r.sourceIds.length} sources</span></div><div class="recipe-facts"><span>${icon('clock')} ${r.limits.minutes ? r.limits.minutes + ' minutes' : 'No time limit'}</span><span>${icon('file')} ${r.limits.files ? number(r.limits.files) + ' documents' : 'No document limit'}</span><span>${icon('source')} ${r.limits.megabytes ? r.limits.megabytes + ' MB' : 'No size limit'}</span></div><div class="recipe-actions"><button class="button secondary" data-edit-recipe="${r.id}">Edit recipe</button><button class="button primary" data-run-recipe="${r.id}">${icon('play')} Collect</button><button class="icon-button" data-delete-recipe="${r.id}" aria-label="Delete ${esc(r.name)}">${icon('close')}</button></div></article>`).join('')}</div>${!state.recipes.length ? `<div class="empty large"><div class="empty-icon">${icon('sliders')}</div><h2>A repeatable recipe for better data.</h2><p>Choose sources once. Save your keyword filters, license policy, and stopping conditions.</p><button class="button primary" data-action="new-recipe">${icon('plus')} Build your first recipe</button></div>` : ''}`;
}
function jobPage() {
  const active = state.jobs.find(j => ['running', 'paused', 'stopping'].includes(j.status));
  return `${heading('THE COLLECTION FLOOR', 'Let your sources do the work.', 'Live progress, clear limits, and a record of every decision.', `<button class="button primary" data-action="new-recipe">${icon('plus')} New collection</button>`)}${active ? `<div class="active-job"><div><span class="eyebrow">CURRENT COLLECTION</span><h2>${esc(active.name)}</h2>${status(active)}</div><div class="active-numbers"><strong>${number(active.accepted)}<small>accepted</small></strong><strong>${number(active.rejected)}<small>filtered</small></strong><strong>${bytes(active.bytes)}<small>stored</small></strong></div><div class="heading-actions"><button class="button secondary" data-action="pause-job">${icon(active.status === 'paused' ? 'play' : 'pause')}${active.status === 'paused' ? 'Resume' : 'Pause'}</button><button class="button danger" data-action="stop-job">${icon('stop')}Stop</button></div></div>` : ''}<div class="panel"><div class="table-wrap"><table><thead><tr><th>COLLECTION</th><th>STATUS</th><th>ACCEPTED / FILTERED</th><th>STORAGE</th><th>STOP REASON</th><th></th></tr></thead><tbody>${state.jobs.map(j => `<tr><td><button class="row-link" data-job-detail="${j.id}">${esc(j.name)}</button><small>${new Date(j.startedAt).toLocaleString()}</small></td><td>${status(j)}</td><td>${number(j.accepted)} <span class="muted">/ ${number(j.rejected)}</span></td><td>${bytes(j.bytes)}</td><td class="stop-reason">${esc(j.reason || 'Collecting from selected sources…')}</td><td>${['paused', 'interrupted', 'stopped', 'failed', 'completed_with_errors'].includes(j.status) ? `<button class="button secondary small" data-resume="${j.id}">Resume</button>` : ''}<button class="icon-button" data-job-detail="${j.id}" aria-label="Inspect ${esc(j.name)}">${icon('arrow')}</button></td></tr>`).join('')}</tbody></table></div>${!state.jobs.length ? '<div class="empty"><h3>No collections yet.</h3><p>Start a recipe to see live progress here.</p></div>' : ''}</div>`;
}
function datasetPage() {
  const jobs = state.jobs.filter(j => j.accepted > 0 || ['paused', 'interrupted', 'stopped', 'failed', 'completed_with_errors'].includes(j.status));
  return `${heading('READY FOR WHAT’S NEXT', 'Your collected datasets.', 'Inspect the output. Export text or JSONL with a companion provenance manifest.')}<div class="dataset-list">${jobs.map(j => `<article class="dataset-card"><span class="dataset-symbol">${icon('folder')}</span><div class="dataset-info"><h2>${esc(j.name)}</h2><p>${number(j.accepted)} documents <span>·</span> ${bytes(j.bytes)} <span>·</span> ${new Date(j.startedAt).toLocaleDateString()}</p><p class="dataset-path">${esc(j.directory || 'Workspace dataset folder')}</p><div class="license-tags">${Object.keys(j.licenses).slice(0, 5).map(l => `<span class="tag">${esc(l)}</span>`).join('')}</div></div><div class="dataset-actions"><button class="button secondary" data-open-dataset="${j.id}">Open folder</button><button class="button secondary" data-move-dataset="${j.id}" ${state.workspaceBusy || ['running', 'paused', 'stopping'].includes(j.status) ? 'disabled' : ''}>Change folder</button><button class="button secondary" data-browse="${j.id}">Browse records</button><button class="button secondary" data-job-detail="${j.id}">Run details</button>${['paused', 'interrupted', 'stopped', 'failed', 'completed_with_errors'].includes(j.status) ? `<button class="button secondary" data-resume="${j.id}" ${state.workspaceBusy ? 'disabled' : ''}>Resume</button>` : ''}${['running', 'paused', 'stopping'].includes(j.status) ? '<span class="muted">Finish run to export</span>' : `<button class="button secondary" data-export="${j.id}" data-format="text">Text output</button><button class="button primary" data-export="${j.id}" data-format="jsonl">${icon('download')} JSONL</button>`}</div></article>`).join('')}</div>${!jobs.length ? '<div class="empty large"><div class="empty-icon">' + icon('folder') + '</div><h2>Room for your next discovery.</h2><p>Accepted records appear here as your collections run.</p><button class="button primary" data-action="new-recipe">Create collection</button></div>' : ''}`;
}
function textOutputPanel() {
  const preferences = state.textOutput || defaultTextOutput();
  const labels = { representation: 'Output format', encoding: 'Character encoding', normalization: 'Unicode normalization', newlines: 'Line endings', bom: 'Byte order mark (BOM)', compression: 'Compression' };
  return `<section class="panel settings-panel"><h2>Text output</h2><p class="muted">Used by the Text output button in Datasets. Original downloads always keep their exact bytes. Stored records and JSONL exports always use UTF-8 without a BOM.</p><form id="text-output-settings"><div class="form-grid">${Object.entries(outputOptions).map(([name, options]) => `<label class="field">${labels[name]}<select name="${name}" ${name !== 'representation' && preferences.representation === 'originals' ? 'disabled' : ''}>${options.map(([value, label]) => `<option value="${value}" ${preferences[name] === value ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select></label>`).join('')}</div><p class="field-hint">Preserve source files exports unchanged originals with a UTF-8 JSONL index; the other controls do not apply. LaTeX only uses actual .tex files from saved sources and archives, and skips records without them. It does not convert PDF text to LaTeX.</p><p class="field-hint">NFC preserves canonical equivalence. NFKC and NFKD can change mathematical symbols and code. Markdown wraps extracted text with a title and source link. gzip reduces file size without changing decoded text.</p><button type="button" class="button primary" data-action="save-text-output">Save text output</button></form></section>`;
}
function settingsPage() {
  return `${heading('YOUR WORKSPACE, CONNECTED', 'Connections & settings.', 'Credentials stay on this computer and never enter your exported datasets.')}<div class="settings-layout"><div>${textOutputPanel()}<section class="panel settings-panel"><h2>API credentials</h2><div><button class="button secondary" data-action="import-keys">Import keys JSON</button><button class="button secondary" data-action="export-keys" ${Object.values(state.credentialStatus).some(Boolean) ? '' : 'disabled'}>Export keys JSON</button></div><p class="field-hint">Portable JSON files contain plaintext API keys. Protect the file when moving it between devices. Import accepts source IDs mapped to keys, or an exported Maine Source credential bundle.</p><p class="muted">${state.secureStorage ? 'Saved credentials use the operating system’s encrypted storage.' : 'Encrypted storage is unavailable. Credentials can be used for this session only.'}</p>${state.sourceCatalog.filter(s => s.key).map(s => `<div class="connection-row">${mark(s.id)}<div><strong>${esc(s.name)}</strong><small>${esc(s.key)}</small></div><span class="connection-state ${state.credentialStatus[s.id] ? 'connected' : ''}">${state.credentialStatus[s.id] ? 'Saved / in session' : 'Not configured'}</span><button class="button secondary small" data-test-credential="${s.id}" ${state.credentialStatus[s.id] ? '' : 'disabled'}>Test connection</button><button class="button secondary small" data-credential="${s.id}">${state.credentialStatus[s.id] ? 'Manage' : 'Connect'}</button></div>`).join('')}</section></div><aside><section class="panel settings-panel"><span class="eyebrow">LOCAL BY DESIGN</span><h2>Your data stays with you.</h2><p>Datasets and exports are saved in the data folder on your Desktop. API credentials and preferences stay in private application storage.</p><code class="data-path">${esc(state.dataPath)}</code><button class="button secondary" data-action="open-data">${icon('folder')} Open data folder</button><button class="button secondary" data-action="check-space">Check free space</button><button class="button secondary" data-action="move-storage" ${state.workspaceBusy ? 'disabled' : ''}>Move storage to another drive</button><p class="field-hint">Copies data into a new Maine-Source folder and keeps the previous folder as a backup. Stop collection first. ${state.workspaceBusy ? 'A workspace operation is in progress.' : ''}</p></section><section class="panel settings-panel"><h2>Unsigned Windows release</h2><p>Maine Source is unsigned because the developer cannot currently afford code signing. Windows may show an unknown-publisher or protection warning. Downloads and SHA-256 checksums are published on the project’s GitHub releases page. This app has not had an independent security audit.</p><button class="button secondary" data-link="https://github.com/Lithium357/Maine-Source/releases">Official releases</button></section><section class="panel settings-panel"><h2>Bring your own files</h2><p>Use text, code, Markdown, or JSONL. License metadata can be included in JSONL records.</p><button class="button secondary" data-action="pick-local">Choose files</button><p class="muted">${state.localFiles.length ? state.localFiles.map(esc).join(', ') : 'No local files selected for this session.'}</p></section></aside></div>`;
}
function openRecipe(existing) {
  draft = existing ? structuredClone(existing) : { ...defaultRecipe(), sourceIds: [...selected] };
  modal.innerHTML = `<div class="modal-backdrop"><section class="modal recipe-modal" role="dialog" aria-modal="true" aria-labelledby="recipe-title"><header class="modal-header"><div><p class="eyebrow">DATASET RECIPE</p><h2 id="recipe-title">${existing ? 'Fine-tune your collection.' : 'Make it your dataset.'}</h2></div><button class="icon-button" data-close-modal aria-label="Close recipe">${icon('close')}</button></header><form id="recipe-form"><div class="modal-body"><label class="field">Dataset name<input name="name" value="${esc(draft.name === 'Untitled dataset' ? '' : draft.name)}" placeholder="e.g. Engineering field notes" required maxlength="120"></label>
    <section class="form-section"><h3><span>01</span> Choose your sources</h3><p>Only the sources checked here will run. Each source gets its own query.</p><label class="field">Content to collect<select name="contentMode"><option value="full" ${(draft.contentMode || 'full') === 'full' ? 'selected' : ''}>Underlying content + original files + metadata</option><option value="metadata" ${draft.contentMode === 'metadata' ? 'selected' : ''}>Metadata / discovery records only</option></select><span class="field-hint">Full content is the default. Unavailable files are reported; descriptions are never silently substituted.</span></label><div class="form-grid"><label class="field">Maximum MB per original file<input name="maxFileMB" type="number" min="1" max="500" value="${draft.contentLimits?.maxFileMB || 50}"></label><label class="field">Maximum original MB per record<input name="maxRecordMB" type="number" min="1" max="1000" value="${draft.contentLimits?.maxRecordMB || 200}"></label></div><label class="check-row"><input name="requireText" type="checkbox" ${draft.requireText ? 'checked' : ''}>Exclude original files if no searchable text can be extracted</label><div class="recipe-source-options">${state.sourceCatalog.filter(s => !s.planned).map(s => `<label><input type="checkbox" name="recipeSource" value="${s.id}" ${draft.sourceIds.includes(s.id) ? 'checked' : ''}>${esc(s.name)}</label>`).join('')}</div><div id="source-configs"></div></section>
    <section class="form-section"><h3><span>02</span> Define what belongs</h3><div class="form-grid"><label class="field">Keyword blacklist<span class="field-hint">One word or phrase per line. Matching records are excluded.</span><textarea name="blacklist" rows="4" placeholder="A word or phrase to leave out">${esc(draft.blacklist)}</textarea></label><div><label class="field">Minimum text length<input type="number" name="minLength" min="0" value="${draft.minLength}"><span class="field-hint">Characters, excluding surrounding whitespace</span></label><label class="check-row"><input type="checkbox" name="deduplicate" ${draft.deduplicate ? 'checked' : ''}>Remove duplicate text within a run</label><label class="check-row"><input type="checkbox" name="wholeWords" ${draft.wholeWords ? 'checked' : ''}>Match whole words</label><label class="check-row"><input type="checkbox" name="caseSensitive" ${draft.caseSensitive ? 'checked' : ''}>Case sensitive</label></div></div>
    <label class="field">License policy<select name="licenseMode"><option value="any" ${draft.licenseMode === 'any' ? 'selected' : ''}>Any license, subject to evidence rules</option><option value="allowlist" ${draft.licenseMode === 'allowlist' ? 'selected' : ''}>Only licenses I select</option><option value="off" ${draft.licenseMode === 'off' ? 'selected' : ''}>Disable license filtering; keep metadata</option></select></label><div class="form-grid"><div class="license-picker"><label class="field">Allowed licenses<input type="search" id="allow-search" placeholder="Search SPDX IDs or enter custom terms" autocomplete="off"></label><div id="allow-options" class="license-options"></div><div id="allow-tags" class="license-tags"></div></div><div class="license-picker"><label class="field">Excluded licenses<input type="search" id="exclude-search" placeholder="Search SPDX IDs or enter custom terms" autocomplete="off"></label><div id="exclude-options" class="license-options"></div><div id="exclude-tags" class="license-tags"></div></div></div>
    <div class="strictness-box"><div class="strictness-heading"><strong>License evidence strictness</strong><span id="strictness-number">${draft.strictness} / 10</span></div><input type="range" name="strictness" min="1" max="10" step="1" value="${draft.strictness}" aria-label="License evidence strictness"><div class="range-ends"><span>1 · Passive</span><span>10 · Strict</span></div><p id="strictness-description"></p><small>This is an evidence rule, not a legal confidence score. Explicit exclusions always apply.</small></div></section>
    <section class="form-section"><h3>Download folder</h3><p>Create a separate dataset subfolder here. Leave the default to use your workspace location.</p><code id="download-directory" class="data-path">${esc(draft.downloadDirectory || 'Default workspace dataset folder')}</code><button type="button" class="button secondary" data-action="pick-download-folder">Choose folder</button><button type="button" class="button secondary" data-action="reset-download-folder">Use default</button><p class="field-hint">This choice is saved with the recipe. Existing datasets can be relocated from Datasets → Change folder after stopping collection. External drives must be connected to resume, browse, or export.</p></section><section class="form-section"><h3><span>03</span> Tell it when to stop</h3><p>The first limit reached stops the entire job. Use 0 to disable a limit.</p><div class="form-grid thirds"><label class="field">Wall-clock minutes<input name="minutes" type="number" min="0" step="0.1" value="${draft.limits.minutes}"></label><label class="field">Output storage (MB)<input name="megabytes" type="number" min="0" step="0.1" value="${draft.limits.megabytes}"></label><label class="field">Accepted documents / files<input name="files" type="number" min="0" step="1" value="${draft.limits.files}"></label></div><p class="field-hint">Time includes pauses and rate-limit waits. Storage includes record JSON and original files. Document limits count accepted records, each of which may have multiple original files.</p></section><p id="recipe-error" class="form-error" role="alert"></p></div><footer class="modal-footer"><span>Saved locally. Ready to repeat.</span><button type="submit" class="button secondary" name="intent" value="save">Save recipe</button><button type="submit" class="button primary" name="intent" value="run">${icon('play')} Save & collect</button></footer></form></section></div>`;
  sourceConfigs(); licenseOptions('allow'); licenseOptions('exclude'); strictnessDescription();
  modal.querySelector('[name="name"]').focus();
  modal.querySelectorAll('[name="recipeSource"]').forEach(el => el.addEventListener('change', () => { captureConfigs(); draft.sourceIds = [...modal.querySelectorAll('[name="recipeSource"]:checked')].map(i => i.value); sourceConfigs(); }));
  modal.querySelector('[name="strictness"]').addEventListener('input', strictnessDescription);
  modal.querySelector('[name="licenseMode"]').addEventListener('change', strictnessDescription);
  for (const type of ['allow', 'exclude']) modal.querySelector(`#${type}-search`).addEventListener('input', () => licenseOptions(type));
  modal.querySelector('#recipe-form').addEventListener('submit', submitRecipe);
  bindModal();
}
function sourceConfigs() {
  modal.querySelector('#source-configs').innerHTML = draft.sourceIds.map(id => {
    const s = source(id);
    const query = s.multiline ? `<textarea rows="3" data-source-input="${esc(id)}">${esc(draft.inputs[id] || '')}</textarea>` : `<input data-source-input="${esc(id)}" value="${esc(draft.inputs[id] || '')}">`;
    const fields = (s.fields || []).map(field => {
      const value = draft.settings[id]?.[field.id] ?? field.default ?? field.options?.[0] ?? '';
      const attribute = `data-source-setting="${esc(id)}.${esc(field.id)}"`;
      const control = field.options ? `<select ${attribute}>${field.options.map(option => `<option value="${esc(option)}" ${String(value) === String(option) ? 'selected' : ''}>${esc(option || 'All')}</option>`).join('')}</select>` : `<input ${attribute} type="${field.type === 'number' ? 'number' : 'text'}" value="${esc(value)}" placeholder="${esc(field.placeholder || '')}" ${field.min !== undefined ? `min="${esc(field.min)}"` : ''} ${field.max !== undefined ? `max="${esc(field.max)}"` : ''} ${field.step ? `step="${esc(field.step)}"` : ''}>`;
      return `<label class="field">${esc(field.label)}${control}</label>`;
    }).join('');
    return `<div class="source-config"><div class="source-config-title">${mark(id)}<strong>${esc(s.name)}</strong>${s.key ? `<button type="button" class="text-button" data-credential="${esc(id)}">${state.credentialStatus[id] ? 'Credential configured' : 'Set credential in Connections'}</button>` : ''}</div>${id === 'local' ? `<p>${state.localFiles.length ? state.localFiles.map(esc).join(', ') : 'Choose files from Connections & settings before running.'}</p>` : `<label class="field">${esc(s.input || 'Optional search keyword')}${query}</label>`}${fields}</div>`;
  }).join('');
}
function captureConfigs() { modal.querySelectorAll('[data-source-input]').forEach(el => draft.inputs[el.dataset.sourceInput] = el.value.trim()); modal.querySelectorAll('[data-source-setting]').forEach(el => { const [id, key] = el.dataset.sourceSetting.split('.'); draft.settings[id] ||= {}; draft.settings[id][key] = el.value.trim(); }); }
function strictnessDescription() { const level = Number(modal.querySelector('[name="strictness"]').value); const off = modal.querySelector('[name="licenseMode"]').value === 'off'; modal.querySelector('#strictness-number').textContent = `${level} / 10`; modal.querySelector('#strictness-description').textContent = off ? 'License filtering is disabled. Evidence strictness will apply when you enable it.' : state.licenseLevels[level - 1]; modal.querySelector('[name="strictness"]').disabled = off; }
function licenseOptions(type) {
  const query = modal.querySelector(`#${type}-search`).value.trim();
  const key = type === 'allow' ? 'allowLicenses' : 'excludeLicenses';
  const options = state.licenseIds.filter(id => id.toLowerCase().includes(query.toLowerCase())).slice(0, query ? 12 : 6);
  const defaults = ['CC0-1.0', 'MIT', 'Apache-2.0', 'CC-BY-4.0', 'CC-BY-SA-4.0', 'LicenseRef-Public-Domain'];
  const list = query ? options : defaults;
  if (query && !list.includes(query) && !state.licenseIds.some(id => id.toLowerCase() === query.toLowerCase())) list.push(query);
  modal.querySelector(`#${type}-options`).innerHTML = list.filter(id => !draft[key].includes(id)).map(id => `<button type="button" data-add-license="${type}" data-license="${esc(id)}">+ ${esc(id)}</button>`).join('');
  modal.querySelector(`#${type}-tags`).innerHTML = draft[key].map(id => `<button type="button" class="tag selected-tag" data-remove-license="${type}" data-license="${esc(id)}">${esc(id)} ×</button>`).join('');
}
async function submitRecipe(event) {
  event.preventDefault(); captureConfigs();
  const form = new FormData(event.target);
  Object.assign(draft, { name: form.get('name').trim(), contentMode: form.get('contentMode'), requireText: form.has('requireText'), contentLimits: { maxFileMB: Number(form.get('maxFileMB')), maxRecordMB: Number(form.get('maxRecordMB')) }, blacklist: form.get('blacklist'), minLength: Number(form.get('minLength')), wholeWords: form.has('wholeWords'), caseSensitive: form.has('caseSensitive'), deduplicate: form.has('deduplicate'), licenseMode: form.get('licenseMode'), strictness: Number(modal.querySelector('[name="strictness"]').value), limits: { minutes: Number(form.get('minutes')), megabytes: Number(form.get('megabytes')), files: Number(form.get('files')) } });
  const button = event.submitter; button.disabled = true;
  try { const id = await call('recipe:save', draft); draft.id = id; if (button.value === 'run') await call('job:start', draft); closeModal(); view = button.value === 'run' ? 'jobs' : 'recipes'; shell(); toast(button.value === 'run' ? 'Collection started.' : 'Recipe saved.'); }
  catch (e) { modal.querySelector('#recipe-error').textContent = e.message; button.disabled = false; }
}
function widgetPicker() {
  modal.innerHTML = `<div class="modal-backdrop"><section class="modal small-modal" role="dialog" aria-modal="true" aria-labelledby="widget-title"><header class="modal-header"><h2 id="widget-title">Your dashboard, your way.</h2><button class="icon-button" data-close-modal aria-label="Close">${icon('close')}</button></header><div class="modal-body">${state.widgetCatalog.map(w => `<label class="widget-choice"><input type="checkbox" data-widget-toggle="${w.id}" ${state.dashboard.includes(w.id) ? 'checked' : ''}><span><strong>${w.name}</strong><small>${w.description}</small></span></label>`).join('')}</div><footer class="modal-footer"><button class="button primary" data-close-modal>Done</button></footer></section></div>`; bindModal();
}
function credentialModal(id) {
  const s = source(id);
  modal.innerHTML = `<div class="modal-backdrop"><section class="modal small-modal" role="dialog" aria-modal="true" aria-labelledby="credential-title"><header class="modal-header"><h2 id="credential-title">Connect ${esc(s.name)}</h2><button class="icon-button" data-close-modal aria-label="Close">${icon('close')}</button></header><form id="credential-form"><div class="modal-body"><p>${esc(s.key)}</p>${id === 'github' ? '<p>Public repositories work without a token. If you use a fine-grained token, keep it read-only. This app never writes to GitHub.</p>' : ''}<label class="field">API key or token<input name="key" type="password" autocomplete="off" placeholder="Paste your credential" required></label><label class="check-row"><input name="persist" type="checkbox" ${state.secureStorage ? 'checked' : 'disabled'}>Remember using encrypted system storage</label><p class="field-hint">Uncheck to keep the credential in memory for this app session.</p></div><footer class="modal-footer">${state.credentialStatus[id] ? `<button type="button" class="button danger" data-clear-credential="${id}">Remove credential</button>` : ''}<button type="submit" class="button primary">Save credential</button></footer></form></section></div>`;
  modal.querySelector('#credential-form').addEventListener('submit', async e => { e.preventDefault(); const form = new FormData(e.target); await call('credential:save', { id, key: form.get('key'), persist: form.has('persist') }); closeModal(); toast('Credential saved locally.'); }); bindModal(); modal.querySelector('[name="key"]').focus();
}
function attachmentControls(sample, jobId) {
  return `${sample.contentStatus ? `<p>Content: ${esc(sample.contentStatus)}</p>` : ''}${(sample.attachments || []).map(a => `<p><button class="text-button" data-show-attachment="${esc(a.path)}" data-attachment-job="${esc(jobId)}">${icon('folder')} ${esc(a.filename)} · ${bytes(a.bytes)} — Show original</button></p>`).join('')}${(sample.contentFailures || []).map(f => `<p class="form-error">${esc(f.file)}: ${esc(f.message)}</p>`).join('')}`;
}
function jobDetail(id) {
  const job = state.jobs.find(j => j.id === id); if (!job) return;
  modal.innerHTML = `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="detail-title"><header class="modal-header"><div><p class="eyebrow">COLLECTION DETAILS</p><h2 id="detail-title">${esc(job.name)}</h2></div><button class="icon-button" data-close-modal aria-label="Close">${icon('close')}</button></header><div class="modal-body">${status(job)}<p>${esc(job.reason || 'Collection in progress. Reopen this panel to refresh details.')}</p><div class="detail-metrics"><span><strong>${number(job.accepted)}</strong> accepted</span><span><strong>${number(job.rejected)}</strong> filtered</span><span><strong>${bytes(job.bytes)}</strong> stored</span><span><strong>${job.errors}</strong> source errors</span></div><h3>Recent accepted records</h3>${job.samples.map(s => `<article class="record-preview"><div><strong>${esc(s.title)}</strong><span class="tag">${esc(s.license)}</span></div><p>${esc(s.preview)}</p>${attachmentControls(s, job.id)}${s.url?.startsWith('https://') ? `<button class="text-button" data-link="${esc(s.url)}">View source ${icon('external')}</button>` : ''}</article>`).join('') || '<p class="muted">No accepted records in this run.</p>'}<h3>Recent decisions & events</h3><div class="detail-events">${[...job.events].reverse().map(e => `<div><time>${new Date(e.time).toLocaleTimeString()}</time><span class="event-dot ${esc(e.kind)}"></span><p>${esc(e.message)}</p></div>`).join('')}</div></div><footer class="modal-footer">${['paused', 'interrupted', 'stopped', 'failed', 'completed_with_errors'].includes(job.status) ? `<button class="button primary" data-resume="${id}">Resume collection</button>` : ''}<button class="button secondary" data-copy-recipe="${id}">Use these settings again</button><button class="button primary" data-close-modal>Done</button></footer></section></div>`; bindModal();
}
async function resumeModal(id) {
  const paused = state.jobs.find(j => j.id === id && j.status === 'paused');
  if (paused) { await call('job:resume', { id }); closeModal(); view = 'jobs'; shell(); toast('Collection resumed.'); return; }
  const job = state.jobs.find(j => j.id === id);
  modal.innerHTML = `<div class="modal-backdrop"><section class="modal small-modal" role="dialog" aria-modal="true" aria-labelledby="resume-title"><header class="modal-header"><h2 id="resume-title">Resume ${esc(job.name)}</h2><button class="icon-button" data-close-modal aria-label="Close">${icon('close')}</button></header><form id="resume-form"><div class="modal-body"><p>Continue this dataset using saved records. Failed items are retried. Some sources revisit discovery pages; saved content is skipped. Local imports require reselecting the same files.</p>${job.recipe.sourceIds.includes('local') ? '<button type="button" class="button secondary" data-action="pick-local">Choose original local files</button>' : ''}<p>Budgets are totals for the entire run, including previous sessions. Increase a reached limit to continue. Zero disables that limit.</p>${[['minutes', 'Total collection minutes (including pauses)'], ['megabytes', 'Total saved MB'], ['files', 'Total accepted records']].map(([key, label]) => `<label class="field">${label}<input name="${key}" type="number" min="0" step="${key === 'files' ? '1' : 'any'}" value="${job.recipe.limits[key]}"></label>`).join('')}<p>${number(job.accepted)} records and ${bytes(job.bytes)} already saved.</p></div><footer class="modal-footer"><button type="submit" class="button primary">Resume collection</button></footer></form></section></div>`;
  modal.querySelector('#resume-form').addEventListener('submit', async e => { e.preventDefault(); const limits = Object.fromEntries([...new FormData(e.target)].map(([key, value]) => [key, Number(value)])); try { await call('job:resume', { id, limits }); closeModal(); view = 'jobs'; shell(); } catch {} });
}
async function browseDataset(id, filters = {}, offset = 0) {
  const request = ++browserRequest;
  const result = await call('dataset:browse', { id, ...filters, offset });
  if (request !== browserRequest) return;
  browserState = { id, filters, offset };
  const job = state.jobs.find(j => j.id === id);
  modal.innerHTML = `<div class="modal-backdrop"><section class="modal recipe-modal" role="dialog" aria-modal="true" aria-labelledby="browse-title"><header class="modal-header"><div><p class="eyebrow">ALL SAVED RECORDS</p><h2 id="browse-title">${esc(job.name)}</h2></div><button class="icon-button" data-close-modal aria-label="Close">${icon('close')}</button></header><div class="modal-body"><form id="dataset-search"><label class="field">Search title and full text<input name="query" type="search" value="${esc(filters.query || '')}" maxlength="1000"></label><div class="form-grid"><label class="field">Source<select name="source"><option value="">All sources</option>${job.recipe.sourceIds.map(id => `<option value="${esc(id)}" ${filters.source === id ? 'selected' : ''}>${esc(source(id)?.name || id)}</option>`).join('')}</select></label><label class="field">License<select name="license"><option value="">All licenses</option>${Object.keys(job.licenses).map(l => `<option ${filters.license === l ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label><label class="field">Content status<select name="status"><option value="">Any status</option>${['downloaded', 'partial', 'metadata'].map(v => `<option ${filters.status === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label></div><button class="button secondary" type="submit">Search records</button></form><p role="status">${number(result.total)} matching records · showing ${result.total ? offset + 1 : 0}–${Math.min(offset + result.rows.length, result.total)}</p>${result.rows.map(r => `<article class="record-preview"><div><button class="text-button" data-record="${r.file}">${esc(r.title || r.file)}</button><span class="tag">${esc(r.license)}</span></div><p>${esc(r.preview)}</p><small>${esc(r.source)} · ${number(r.characters)} characters · ${esc(r.status || 'text')}</small></article>`).join('') || '<p>No matching records.</p>'}</div><footer class="modal-footer"><button class="button secondary" data-browse-page="${Math.max(0, offset - result.limit)}" ${offset === 0 ? 'disabled' : ''}>Previous records</button><button class="button secondary" data-browse-page="${offset + result.limit}" ${offset + result.limit >= result.total ? 'disabled' : ''}>Next records</button><button class="button secondary" data-validate="${id}">Validate dataset</button><button class="button secondary" data-delete-dataset="${id}">Move to Recycle Bin</button><button class="button primary" data-close-modal>Done</button></footer></section></div>`;
  modal.querySelector('#dataset-search').addEventListener('submit', e => { e.preventDefault(); browseDataset(id, Object.fromEntries(new FormData(e.target))).catch(() => {}); });
}
async function showRecord(file, offset = 0) {
  const request = ++browserRequest, id = browserState.id;
  const r = await call('dataset:record', { id, file, offset }); if (request !== browserRequest) return;
  modal.innerHTML = `<div class="modal-backdrop"><section class="modal recipe-modal" role="dialog" aria-modal="true" aria-labelledby="record-title"><header class="modal-header"><h2 id="record-title">${esc(r.title || file)}</h2><button class="icon-button" data-close-modal aria-label="Close">${icon('close')}</button></header><div class="modal-body"><p>${esc(r.source)} · ${esc(r.version || 'No version supplied')} · ${esc(r.rights?.expression || 'Unknown license')}</p><p>${esc(r.attribution || '')}</p>${r.url?.startsWith('https://') ? `<button class="text-button" data-link="${esc(r.url)}">View source</button>` : ''}${attachmentControls(r, id)}<p>Characters ${offset + 1}–${Math.min(offset + r.text.length, r.characters)} of ${number(r.characters)}</p><pre class="record-text">${esc(r.text)}</pre></div><footer class="modal-footer"><button class="button secondary" data-record="${file}" data-text-offset="${Math.max(0, offset - 25000)}" ${offset === 0 ? 'disabled' : ''}>Previous text</button><button class="button secondary" data-record="${file}" data-text-offset="${offset + 25000}" ${offset + 25000 >= r.characters ? 'disabled' : ''}>Next text</button><button class="button primary" data-back-records>Back to records</button></footer></section></div>`;
}
async function datasetReport(id) {
  toast('Checking records and original-file hashes…');
  const report = await call('dataset:validate', { id });
  modal.innerHTML = `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="report-title"><header class="modal-header"><h2 id="report-title">Dataset validation</h2><button class="icon-button" data-close-modal aria-label="Close">${icon('close')}</button></header><div class="modal-body"><p>${number(report.records)} records · ${number(report.attachments)} original files checked</p><p>${number(report.emptyText)} empty texts · ${number(report.duplicateText)} duplicate texts · ${number(report.unknownLicense)} unknown licenses · ${number(report.extractionFailures)} download/extraction warnings</p><h3>${report.issues.length ? 'Integrity problems (first 100)' : 'No integrity problems found'}</h3><pre class="record-text">${esc(report.issues.join('\n') || 'Saved originals match their recorded sizes and SHA-256 hashes.')}</pre><p>Content warnings and unknown licenses are reported separately from file integrity.</p></div><footer class="modal-footer"><button class="button primary" data-back-records>Back to records</button></footer></section></div>`;
}
function closeModal() { browserRequest++; modal.innerHTML = ''; draft = null; }
function bindModal() { /* Events are delegated below so rebuilt form sections retain their behavior. */ }
function bindPage() {
  document.querySelector('#source-search')?.addEventListener('input', e => { const position = e.target.selectionStart; search = e.target.value; renderContent(); const input = document.querySelector('#source-search'); input.focus(); if (input.type !== 'search') input.setSelectionRange(position, position); });
  document.querySelector('#time-range')?.addEventListener('change', e => { range = e.target.value; renderContent(); });
  document.querySelectorAll('[data-widget]').forEach(el => {
    el.addEventListener('dragstart', e => { dragId = el.dataset.widget; e.dataTransfer.setData('text/plain', dragId); el.classList.add('dragging'); });
    el.addEventListener('dragend', () => el.classList.remove('dragging'));
    el.addEventListener('dragover', e => { if (customizing) e.preventDefault(); });
    el.addEventListener('drop', async e => { e.preventDefault(); if (!customizing || !dragId || dragId === el.dataset.widget) return; const ids = state.dashboard.filter(id => id !== dragId); ids.splice(ids.indexOf(el.dataset.widget), 0, dragId); await call('dashboard:save', ids); });
  });
}
document.addEventListener('change', async event => {
  const el = event.target;
  if (el.name === 'source') { selected = el.checked ? [...new Set([...selected, el.value])] : selected.filter(id => id !== el.value); renderContent(); }
  if (el.dataset.widgetToggle) { const ids = el.checked ? [...state.dashboard, el.dataset.widgetToggle] : state.dashboard.filter(id => id !== el.dataset.widgetToggle); await call('dashboard:save', ids); }
});
document.addEventListener('click', async event => {
  const button = event.target.closest('button, a[data-view]'); if (!button) return;
  if (button.matches('[data-close-modal]')) { closeModal(); return; }
  if (button.dataset.link) { event.preventDefault(); event.stopPropagation(); await call('link:open', button.dataset.link); return; }
  try {
    if (button.dataset.view) { event.preventDefault(); view = button.dataset.view; shell(); return; }
    if (button.dataset.category) { category = button.dataset.category; renderContent(); return; }
    if (button.dataset.preset) { selected = [...new Set([...selected, ...state.presets[button.dataset.preset]])]; renderContent(); return; }
    if (button.dataset.editRecipe) return openRecipe(state.recipes.find(r => r.id === button.dataset.editRecipe));
    if (button.dataset.runRecipe) { await call('job:start', state.recipes.find(r => r.id === button.dataset.runRecipe)); view = 'jobs'; shell(); return; }
    if (button.dataset.deleteRecipe) { await call('recipe:delete', button.dataset.deleteRecipe); toast('Recipe deleted.'); return; }
    if (button.dataset.openDataset) return await call('dataset:open', { id: button.dataset.openDataset });
    if (button.dataset.moveDataset) { toast('Copying this dataset. Keep the app open until it finishes.'); return toast(await call('dataset:move', { id: button.dataset.moveDataset })); }
    if (button.dataset.browse) return await browseDataset(button.dataset.browse);
    if (button.hasAttribute('data-browse-page')) return await browseDataset(browserState.id, browserState.filters, Number(button.dataset.browsePage));
    if (button.hasAttribute('data-back-records')) return await browseDataset(browserState.id, browserState.filters, browserState.offset);
    if (button.dataset.record) return await showRecord(button.dataset.record, Number(button.dataset.textOffset || 0));
    if (button.dataset.validate) return await datasetReport(button.dataset.validate);
    if (button.dataset.deleteDataset) { if (await call('dataset:delete', { id: button.dataset.deleteDataset })) { closeModal(); toast('Dataset moved to the Recycle Bin. Existing exports were kept.'); } return; }
    if (button.dataset.resume) return resumeModal(button.dataset.resume);
    if (button.dataset.jobDetail) return jobDetail(button.dataset.jobDetail);
    if (button.dataset.copyRecipe) return openRecipe(state.jobs.find(j => j.id === button.dataset.copyRecipe).recipe);
    if (button.dataset.export) return toast(await call('dataset:export', { id: button.dataset.export, format: button.dataset.format }));
    if (button.dataset.showAttachment) return call('attachment:show', { id: button.dataset.attachmentJob, relative: button.dataset.showAttachment });
    if (button.dataset.credential) { if (draft) { toast('Save your recipe, then add credentials in Connections & settings.'); return; } return credentialModal(button.dataset.credential); }
    if (button.dataset.testCredential) { button.disabled = true; button.textContent = 'Testing…'; try { const result = await call('credential:test', { id: button.dataset.testCredential }); modal.innerHTML = `<div class="modal-backdrop"><section class="modal small-modal" role="dialog" aria-modal="true" aria-labelledby="connection-result-title"><header class="modal-header"><h2 id="connection-result-title">${result.ok ? 'Connection request succeeded' : 'Connection check failed'}</h2><button class="icon-button" data-close-modal aria-label="Close">${icon('close')}</button></header><div class="modal-body"><p>${esc(result.message)}</p><p class="muted">This check did not save a dataset or verify a full download. Quotas and permissions can change.</p></div><footer class="modal-footer"><button class="button primary" data-close-modal>Done</button></footer></section></div>`; bindModal(); } finally { button.disabled = false; button.textContent = 'Test connection'; } return; }
    if (button.dataset.clearCredential) { await call('credential:save', { id: button.dataset.clearCredential, key: '', persist: false }); closeModal(); toast('Credential removed.'); return; }
    if (button.dataset.addLicense || button.dataset.removeLicense) { const type = button.dataset.addLicense || button.dataset.removeLicense; const key = type === 'allow' ? 'allowLicenses' : 'excludeLicenses'; const id = button.dataset.license; draft[key] = button.dataset.addLicense ? [...new Set([...draft[key], id])] : draft[key].filter(x => x !== id); licenseOptions(type); return; }
    if (button.dataset.hideWidget) return await call('dashboard:save', state.dashboard.filter(id => id !== button.dataset.hideWidget));
    if (button.dataset.reorder) { const ids = [...state.dashboard], index = ids.indexOf(button.dataset.reorder), target = Math.max(0, Math.min(ids.length - 1, index + Number(button.dataset.direction))); [ids[index], ids[target]] = [ids[target], ids[index]]; return await call('dashboard:save', ids); }
    switch (button.dataset.action) {
      case 'pick-download-folder': { const chosen = await call('download:choose'); if (chosen) { draft.downloadDirectory = chosen; modal.querySelector('#download-directory').textContent = chosen; } break; }
      case 'reset-download-folder': delete draft.downloadDirectory; modal.querySelector('#download-directory').textContent = 'Default workspace dataset folder'; break;
      case 'import-keys': toast(await call('credential:import')); break;
      case 'export-keys': toast(await call('credential:export')); break;
      case 'new-recipe': openRecipe(); break;
      case 'customize': customizing = !customizing; renderContent(); break;
      case 'widgets': widgetPicker(); break;
      case 'save-text-output': { const form = document.querySelector('#text-output-settings'); const preferences = Object.fromEntries(Object.keys(outputOptions).map(name => [name, form.elements.namedItem(name).value])); await call('output:save', preferences); toast('Text output preferences saved.'); break; }
      case 'save-sources': await call('sources:save', selected); toast('Source selection saved.'); break;
      case 'select-visible': selected = [...new Set([...selected, ...state.sourceCatalog.filter(s => !s.planned && (category === 'All sources' || s.category === category) && `${s.name} ${s.description}`.toLowerCase().includes(search.toLowerCase())).map(s => s.id)])]; renderContent(); break;
      case 'clear-sources': selected = []; renderContent(); break;
      case 'pause-job': await call('job:pause'); break;
      case 'stop-job': await call('job:stop'); break;
      case 'pick-local': await call('local:pick'); break;
      case 'move-storage': toast('Preparing storage copy. Keep the app open until it finishes.'); toast(await call('storage:choose')); break;
      case 'check-space': toast(`${bytes(await call('storage:space'))} available on the data drive.`); break;
      case 'open-data': await call('data:open'); break;
    }
  } catch { /* call() presents the actionable error. */ }
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && modal.innerHTML) closeModal();
  if (event.key === 'Tab' && modal.innerHTML) {
    const focusable = [...modal.querySelectorAll('button, input, textarea, select, a[href]')].filter(el => !el.disabled && el.offsetParent !== null);
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
});
if (!api) root.innerHTML = '<div class="boot">Open Maine Source using the desktop app. For the development UI preview, use ?preview=1.</div>';
else {
  try {
    state = await call('state:get'); selected = [...state.selectedSources]; shell();
    let refreshTimer;
    api.subscribe(next => { state = next; refreshShellStatus(); clearTimeout(refreshTimer); refreshTimer = setTimeout(() => { if (!document.querySelector('#source-search:focus') && view !== 'settings') renderContent(); }, 120); });
  } catch (e) { root.innerHTML = `<div class="boot">Workspace could not open: ${esc(e.message)}</div>`; }
}

document.addEventListener('change', event => {
  if (event.target.matches('#text-output-settings select[name="representation"]')) {
    for (const field of document.querySelectorAll('#text-output-settings select:not([name="representation"])')) field.disabled = event.target.value === 'originals';
  }
});
