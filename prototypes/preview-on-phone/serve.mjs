// PROTOTYPE for issue #18 (throwaway): serves the variant page to a phone on the LAN and
// appends every measurement/rating the phone POSTs to results.jsonl. No dependencies.
// Usage: node serve.mjs   then open http://<this machine's LAN IP>:8018/ on the phone.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const PORT = 8018;
const files = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/model-viewer.min.js': ['node_modules/@google/model-viewer/dist/model-viewer.min.js', 'text/javascript'],
  '/decoders/meshopt_decoder.js': ['node_modules/meshoptimizer/meshopt_decoder.cjs', 'text/javascript'],
  '/out/variants.json': ['out/variants.json', 'application/json'],
};

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'POST' && url.pathname === '/report') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const entry = { at: new Date().toISOString(), ...JSON.parse(body) };
      fs.appendFileSync('results.jsonl', JSON.stringify(entry) + '\n');
      console.log('report', JSON.stringify(entry));
      res.writeHead(204).end();
    });
    return;
  }
  let [file, type] = files[url.pathname] ?? [];
  if (!file && /^\/out\/[\w-]+\.glb$/.test(url.pathname)) [file, type] = [url.pathname.slice(1), 'model/gltf-binary'];
  if (!file || !fs.existsSync(file)) { res.writeHead(404).end('not found'); return; }
  // no-store so every load measures a real download, like a first visit
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Content-Length': fs.statSync(file).size });
  fs.createReadStream(path.resolve(file)).pipe(res);
}).listen(PORT, '0.0.0.0', () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i.family === 'IPv4' && !i.internal).map((i) => i.address);
  console.log(`PROTOTYPE #18 serving on port ${PORT}. Open on the phone: ${ips.map((ip) => `http://${ip}:${PORT}/`).join('  or  ')}`);
});
