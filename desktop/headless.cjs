exports.run = async function (workspace) {
  const path = require('node:path');
  const { pathToFileURL } = require('node:url');
  const { serveAgent } = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'agent-server.mjs')).href);
  await serveAgent({ workspace });
};
