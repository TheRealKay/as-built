// Start-command mode for the tests: `node serve.mjs <port>` serves ./public like a dev server would.
import { startStaticServer } from '../../scripts/shoot.mjs';
import { createServer } from 'node:http';

const port = Number(process.argv[2] || 4173);
const { url } = await startStaticServer(new URL('./public', import.meta.url).pathname);
createServer(async (req, res) => {
  const r = await fetch(url + req.url);
  res.writeHead(r.status, { 'content-type': r.headers.get('content-type') || 'application/octet-stream' });
  res.end(Buffer.from(await r.arrayBuffer()));
}).listen(port, '127.0.0.1');
