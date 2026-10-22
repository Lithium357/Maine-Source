import { dateSetting, endpoint, numberSetting, unknown } from './helpers.mjs';

export default {
  id: 'usgs', name: 'USGS Earthquake Catalog', category: 'Science & engineering', mark: 'EQ', color: '#618d88',
  description: 'Earthquake observations with magnitudes, timestamps, coordinates, and original GeoJSON records.',
  input: 'Start date, YYYY-MM-DD (default: 30 days ago)', docs: 'https://earthquake.usgs.gov/fdsnws/event/1/',
  fields: [{ id: 'endDate', label: 'End date, YYYY-MM-DD (default: today)' }, { id: 'minMagnitude', label: 'Minimum magnitude', default: '2.5', type: 'number', min: -2, max: 10, step: '0.1' }],
  async *collect({ input, settings = {}, http }) {
    const start = dateSetting(input, new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10), 'Start date');
    const end = dateSetting(settings.endDate, new Date().toISOString().slice(0, 10), 'End date');
    if (start > end) throw new Error('Start date must not follow end date');
    const min = numberSetting(settings.minMagnitude, 2.5, -2, 10, 'Minimum magnitude');
    for (let offset = 1;; offset += 100) {
      const page = await http.get(endpoint('https://earthquake.usgs.gov/fdsnws/event/1/query', { format: 'geojson', starttime: start, endtime: `${end}T23:59:59.999`, minmagnitude: min, orderby: 'time-asc', limit: 100, offset, nodata: 204 }));
      if (page === null) break;
      if (!Array.isArray(page.features)) throw new Error('USGS returned an invalid GeoJSON response');
      for (const item of page.features) {
        const p = item.properties || {}; const coordinates = item.geometry?.coordinates || [];
        yield { id: item.id, title: p.title || p.place || item.id, text: `${p.title || p.place}\nMagnitude: ${p.mag} (${p.magType || 'unspecified scale'})\nTime: ${Number.isFinite(p.time) ? new Date(p.time).toISOString() : 'unknown'}\nLongitude: ${coordinates[0]}; latitude: ${coordinates[1]}; depth (km): ${coordinates[2]}\nStatus: ${p.status || 'unknown'}; event type: ${p.type || 'unknown'}`, url: p.url, version: p.updated ? new Date(p.updated).toISOString() : undefined, attribution: 'USGS and contributing seismic networks', rights: unknown(), metadata: { contentScope: 'earthquake observation', geojson: item } };
      }
      if (page.features.length < 100) break;
    }
  },
};
