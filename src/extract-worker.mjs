import { extractTextInline } from './content.mjs';

process.once('message', async data => {
  try {
    const value = await extractTextInline(Buffer.from(data.data), data.filename, data.mediaType);
    process.send({ value });
  } catch (error) { process.send({ error: error.message || 'Text extraction failed' }); }
});
