// PROTOTYPE for issue #18 (throwaway, not production code).
// Builds ONE Preview variant from a Scan's Game asset and prints its stats as JSON.
// Usage: node pipeline.mjs <id> <src.glb> <simplifier> <targetTris> <compression> <texFormat> <texSize>
//   simplifier:  gt | gp | gp-sv | gp-sp | gp-sa   (gt = glTF Transform, gp = gltfpack with extra flags)
//   compression: draco | quant | meshopt | none
//   texFormat:   jpeg | webp
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, simplify, textureCompress, prune, dedup, quantize, draco, meshopt } from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptEncoder } from 'meshoptimizer';
import draco3d from 'draco3dgltf';
import sharp from 'sharp';
import { pack } from 'gltfpack';

const [id, src, simplifier, targetTrisArg, compression, texFormat, texSizeArg] = process.argv.slice(2);
const targetTris = Number(targetTrisArg);
const texSize = Number(texSizeArg);
const outDir = path.resolve('out');
const timings = {};
let t = performance.now();
const lap = (name) => { const n = performance.now(); timings[name] = Math.round(n - t); t = n; };

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.encoder': await draco3d.createEncoderModule(),
  'draco3d.decoder': await draco3d.createDecoderModule(),
  'meshopt.encoder': MeshoptEncoder,
});
await MeshoptSimplifier.ready;
await MeshoptEncoder.ready;

const countTris = (doc) => {
  let tris = 0, verts = 0;
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION'); verts += pos.getCount();
    const idx = prim.getIndices(); tris += (idx ? idx.getCount() : pos.getCount()) / 3;
  }
  return { tris, verts };
};

const srcDoc = await io.read(src);
const before = countTris(srcDoc);
const ratio = Math.min(1, targetTris / before.tris);
lap('read');

let doc;
if (simplifier === 'gt') {
  doc = srcDoc;
  await doc.transform(weld());
  lap('weld');
  await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.01 }));
  lap('simplify');
} else {
  // "w-" prefix: drop the export's per-face normals and weld first, then let gltfpack
  // regenerate smooth normals (-gn 60 = 60° crease angle) after simplifying.
  const welded = simplifier.startsWith('w-');
  const mode = welded ? simplifier.slice(2) : simplifier;
  let input = src;
  const extraPrep = [];
  if (welded) {
    for (const mesh of srcDoc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) prim.setAttribute('NORMAL', null);
    await srcDoc.transform(weld());
    input = path.join(outDir, `${id}.welded-tmp.glb`);
    await io.write(input, srcDoc);
    extraPrep.push('-gn', '60');
    lap('weld');
  }
  // gltfpack works on files; -noq keeps float attributes so the compression step below decides.
  const extra = { 'gp': [], 'gp-sv': ['-sv'], 'gp-sp': ['-sp'], 'gp-sa': ['-sa'] }[mode];
  const tmp = path.join(outDir, `${id}.gltfpack-tmp.glb`);
  await pack(['-i', 'in.glb', '-o', 'out.glb', '-si', String(ratio), '-noq', ...extraPrep, ...extra], {
    read: () => fs.readFileSync(input),
    write: (_p, data) => fs.writeFileSync(tmp, data),
  });
  if (welded) fs.rmSync(input);
  lap('simplify');
  doc = await io.read(tmp);
  fs.rmSync(tmp);
  lap('reread');
}

await doc.transform(
  textureCompress({ encoder: sharp, targetFormat: texFormat, resize: [texSize, texSize], quality: 85 }),
  prune(),
  dedup(),
);
lap('textures');

if (compression === 'draco') await doc.transform(draco({ method: 'edgebreaker' }));
if (compression === 'quant') await doc.transform(quantize());
if (compression === 'meshopt') await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
lap('compress');

const after = countTris(doc);
const outFile = path.join(outDir, `${id}.glb`);
await io.write(outFile, doc);
lap('write');

const stats = {
  id, simplifier, targetTris, compression, texFormat, texSize,
  srcTris: before.tris, srcVerts: before.verts,
  tris: after.tris, verts: after.verts,
  reachedTarget: after.tris <= targetTris * 1.1,
  bytes: fs.statSync(outFile).size,
  extensionsUsed: doc.getRoot().listExtensionsUsed().map((e) => e.extensionName),
  timingsMs: timings,
  totalMs: Object.values(timings).reduce((a, b) => a + b, 0),
  peakRssMB: Math.round(process.resourceUsage().maxRSS / 1024),
};
fs.writeFileSync(path.join(outDir, `${id}.json`), JSON.stringify(stats, null, 1));
console.log(JSON.stringify(stats));
