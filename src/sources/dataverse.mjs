import { endpoint, plain, portalURL, unknown } from './helpers.mjs';

export default {
  id: 'dataverse', name: 'Research Dataverse', category: 'Datasets', mark: 'DV', color: '#cb8b45',
  description: 'Download accessible dataset files, preserving original files, citations, identifiers, and version metadata.',
  input: 'Research search (optional)', docs: 'https://guides.dataverse.org/en/latest/api/search.html',
  fields: [{ id: 'portal', label: 'Dataverse repository URL', default: 'https://dataverse.harvard.edu' }],
  async *collect({ input, settings = {}, http, resume = {}, checkpoint = async () => {} }) {
    const portal = portalURL(settings.portal || 'https://dataverse.harvard.edu');
    for (let start = Number.isSafeInteger(resume.start) && resume.start >= 0 ? resume.start : 0;; start += 100) {
      const page = await http.get(endpoint(`${portal}/api/search`, { q: input || '*', type: 'dataset', per_page: 100, start }), { interval: 1100 });
      if (page.status !== 'OK' || !Array.isArray(page.data?.items)) throw new Error('Dataverse search failed; check the repository URL');
      const items = page.data.items;
      for (const item of items) {
        let version;
        if (settings.contentMode !== 'metadata') {
          const detail = await http.get(endpoint(`${portal}/api/datasets/:persistentId/`, { persistentId: item.global_id }), { interval: 1100 });
          if (detail.status !== 'OK') throw new Error('Dataverse dataset details are unavailable');
          version = detail.data?.latestVersion;
        }
        const files = version?.files || [];
        const base = { id: item.global_id || `${portal}/${item.entity_id}`, title: item.name, text: [item.name, plain(item.description), plain(item.citation)].filter(Boolean).join('\n'), url: item.url, version: version ? `${version.versionNumber}.${version.versionMinorNumber}` : item.published_at, attribution: (item.authors || []).join(', '), rights: version?.license ? { expression: version.license.name, url: version.license.uri, basis: 'source-declaration', scope: 'record' } : unknown(), metadata: { contentScope: 'dataset files requested', portal, original: item, datasetVersion: version } };
        if (settings.contentMode === 'metadata') { yield base; continue; }
        if (!files.length) { yield { ...base, contentRequests: [{ error: 'No accessible dataset file listing was supplied' }] }; continue; }
        for (const file of files) yield { ...base, id: `${base.id}/file/${file.dataFile.id}`, title: `${item.name} / ${file.dataFile.filename}`, contentRequests: [file.restricted ? { filename: file.dataFile.filename, error: 'File is restricted; this public connector has no access' } : { url: `${portal}/api/access/datafile/${file.dataFile.id}?format=original`, filename: file.dataFile.filename, role: 'dataset file' }], metadata: { ...base.metadata, file: file.dataFile } };
      }
      await checkpoint({ start: start + 100 });
      if (items.length < 100 || start + items.length >= page.data.total_count) break;
    }
  },
};
