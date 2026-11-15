// PROTOTYPE for issue #18 (throwaway): how far does welding get once normals are dropped?
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld } from '@gltf-transform/functions';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(process.argv[2]);
const prims = doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives());
const count = () => prims.reduce((a, p) => a + p.getAttribute('POSITION').getCount(), 0);
let t = performance.now();
const ms = () => { const n = performance.now(); const d = Math.round(n - t); t = n; return d; };

console.log('verts before', count());
for (const p of prims) p.setAttribute('NORMAL', null);
await doc.transform(weld());
console.log('verts after dropping normals + weld (position+UV)', count(), `${ms()} ms`);
for (const p of prims) p.setAttribute('TEXCOORD_0', null);
await doc.transform(weld());
console.log('verts after also dropping UVs (position only)', count(), `${ms()} ms`);
