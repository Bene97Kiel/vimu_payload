// PROTOTYPE for issue #18 (throwaway): builds every Preview variant, one child process each
// (so peak memory is per variant), then writes out/variants.json for the phone page.
// Usage: node generate.mjs [path/to/scan.glb]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

// Default: the amphora test Scan, which lives outside the repo (ViMu/Objects/Amphora/).
const src = process.argv[2] ?? '../../../Objects/Amphora/amphora_gltf.glb';
fs.mkdirSync('out', { recursive: true });

// [id, simplifier, targetTris, compression, texFormat, texSize, note]
const variants = [
  ['A-raw-sp-draco', 'gp-sp', 50000, 'draco', 'jpeg', 2048, 'Raw export, gltfpack permissive (-sp), keeps flat normals'],
  ['B-raw-sa-draco', 'gp-sa', 50000, 'draco', 'jpeg', 2048, 'Raw export, gltfpack aggressive (-sa), ignores quality'],
  ['C-weld-draco', 'w-gp', 50000, 'draco', 'jpeg', 2048, 'Drop normals + weld, gltfpack default, smooth normals'],
  ['D-weld-sv-draco', 'w-gp-sv', 50000, 'draco', 'jpeg', 2048, 'Drop normals + weld, gltfpack attribute-aware (-sv)'],
  ['E-weld-sp-draco', 'w-gp-sp', 50000, 'draco', 'jpeg', 2048, 'Drop normals + weld, gltfpack permissive (-sp)'],
  ['F-weld-quant', 'w-gp', 50000, 'quant', 'jpeg', 2048, 'Like C, quantization only: no decoder needed'],
  ['G-weld-meshopt', 'w-gp', 50000, 'meshopt', 'jpeg', 2048, 'Like C, meshopt: needs meshoptDecoderLocation in the app'],
  ['H-weld-none', 'w-gp', 50000, 'none', 'jpeg', 2048, 'Like C, no geometry compression'],
  ['I-weld-100k-draco', 'w-gp', 100000, 'draco', 'jpeg', 2048, 'Like C at the 100k hard max'],
  ['J-weld-draco-webp', 'w-gp', 50000, 'draco', 'webp', 2048, 'Like C with WebP texture'],
];

const results = [];
for (const [id, simplifier, target, compression, texFormat, texSize, note] of variants) {
  process.stdout.write(`${id} ... `);
  const r = spawnSync(process.execPath, ['--no-warnings', '--max-old-space-size=12288', 'pipeline.mjs', id, src, simplifier, String(target), compression, texFormat, String(texSize)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (r.status !== 0) { console.log('FAILED\n' + r.stderr); continue; }
  const s = JSON.parse(r.stdout.trim().split('\n').pop());
  s.note = note;
  results.push(s);
  console.log(`${s.tris} tris, ${(s.bytes / 1048576).toFixed(2)} MB, ${(s.totalMs / 1000).toFixed(1)} s, peak ${s.peakRssMB} MB`);
}
fs.writeFileSync('out/variants.json', JSON.stringify({ source: src, generatedAt: new Date().toISOString(), variants: results }, null, 1));
console.log(`\nWrote out/variants.json (${results.length} variants)`);
