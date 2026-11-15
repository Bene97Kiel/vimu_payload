# How can a Preview and Poster be generated from a Game asset?

> Research for [#15](https://github.com/Bene97Kiel/vimu_payload/issues/15) (map [#9](https://github.com/Bene97Kiel/vimu_payload/issues/9)). Written 2026-11-15.
> Terms follow `GLOSSARY.md`: **Game asset** (the uploaded GLB), **Preview** (light GLB for the app), **Poster** (still image).
> Constraints from [#10](https://github.com/Bene97Kiel/vimu_payload/issues/10): GLB-only ingest, the uploaded GLB *is* the Game asset, the Preview is generated from it, and everything lives in an S3-compatible store.

**No benchmarks were run for this note.** Speed and memory statements come from documentation and source code and are qualitative. Measuring them on a real Scan is part of the Preview prototype ([#18](https://github.com/Bene97Kiel/vimu_payload/issues/18)).

Versions checked on 2026-11-15: glTF Transform 4.5.1 ([npm][npm-gt]), meshoptimizer/gltfpack 1.3, released 2026-09-25 ([release][mo-13]), Blender 5.3.0, released 2026-11-10, and 5.2.4 LTS ([download index][bl-dl53]), `@google/model-viewer` 4.4.0, Playwright 1.65.1, F3D 4.0, Payload 3.85.1 (this repo).

---

## 1. Answer

**Preview: use `gltfpack`.** It is a single native binary (the Linux release zip is about 2 MB) with the BasisU (KTX2) and libwebp encoders compiled in. One command simplifies the mesh, resizes and re-encodes the textures, and quantizes and compresses the geometry. It uses the same meshoptimizer simplifier as glTF Transform, but adds attribute-aware and permissive modes, and as native code it is the fastest of the three tools. Use `@gltf-transform/core` only as a library around it: read the input's triangle count and texture sizes to work out the `-si` ratio, and check the output. Leave Blender out of v1. It is the escalation path if [#18](https://github.com/Bene97Kiel/vimu_payload/issues/18) shows that simplifying while keeping the original UVs is not good enough. In that case the fix is to re-unwrap and bake the texture, which only Blender, or the Provider's own photogrammetry tool, can do.

**Poster: render it from the generated Preview** in headless Chromium, driven by Playwright, using Google's `<model-viewer>`, the same component the collector app shows through `model_viewer_plus`. Grab the frame with `toBlob({ idealAspect: true })`. Chromium renders WebGL on the CPU through SwiftShader, and Playwright enables the required opt-in flag by default.

**Where it runs:** as a **Payload Jobs task**, but executed by a **separate worker container** that runs Payload's `payload jobs:run` bin script on a dedicated queue (for example `scans`). The worker uses the same codebase and config as the web container. Payload documents this script as "a completely separate process from your Next.js server". The web container never runs these jobs. The worker image must be glibc-based (Debian or Ubuntu), because neither Playwright nor the gltfpack release binary supports Alpine/musl, and the current `Dockerfile` uses `node:22-alpine`.

**Main quality risk:** photogrammetry textures are packed into atlases with many separate UV islands. Every simplifier that keeps the original UVs treats the island borders (UV seams) as constraints. As a result, the reachable triangle count at a given error may stay above the Preview budget. Section 4 explains why. [#18](https://github.com/Bene97Kiel/vimu_payload/issues/18) has to measure this on real Scans.

---

## 2. Inputs: what photogrammetry tools export

| Tool | GLB export | Relevant notes |
|---|---|---|
| **RealityScan** (Epic, desktop; formerly RealityCapture) | Yes: "Binary GL Transmission Format (.glb)" is one of its model export formats ([RealityScan help][rs-export]) | Textures can be embedded. A model can carry several textures, which can be stitched into one file with "Texture maximal side" from 512 up to 65536 px. Downscaling to fit "results in lowering of the detail quality". If a model is simplified in RealityScan, it "has to be retextured" before textures can be exported, which shows the tool reprojects texture onto the simplified mesh itself ([RealityScan help][rs-export]). |
| **Agisoft Metashape 2.3** (Standard and Pro) | Yes: "Binary glTF (*.glb)" ([Metashape 2.3 manual][ms-23], export formats list) | The manual warns that a custom face count "over 10 million polygons" is likely to cause visualization problems in external software, and says decimation "is usually a desirable step". Textures can be split across several atlas pages ("Texture size / count"). |
| **Polycam** | glTF is available "on every plan" ([Polycam Basic plan][pc-basic]). Polycam's own blog says it exports both glTF and GLB ([Polycam blog, 2026-07-15][pc-blog]). | Whether the *free* plan gets `.glb` and not only `.gltf` could not be confirmed: the help-center article blocks automated reading. Check this in the app. |
| **KIRI Engine** | Yes: Photo Scan exports "OBJ, FBX, STL, GLB, GLTF, USDZ, PLY, and XYZ" ([KIRI export formats][kiri-formats]) | "Texture exports can go up to 8K", and poly counts "can go up to millions" ([KIRI export quality][kiri-quality]). |

**Typical sizes.** This is my own arithmetic, not a vendor figure. An indexed triangle costs 12 B (three `uint32` indices). A vertex with POSITION, NORMAL and TEXCOORD_0 costs 32 B. A closed mesh has roughly half as many vertices as triangles, plus extra duplicates along UV seams. That gives about **25–35 MB of geometry per million triangles**. One decoded 8K RGBA texture is 8192 × 8192 × 4 B = 256 MiB in RAM, while its JPEG is typically tens of MB and its PNG well over 100 MB. So 1–10M triangles with one or more 4K–8K textures lands at the expected **50–500 MB per GLB**. Several texture pages per model are common (RealityScan tiles, Metashape atlas pages), and they multiply both the file size and the memory needed to decode it.

---

## 3. The three Preview tools

### 3.1 Overview

| | **glTF Transform** (CLI and Node library) | **gltfpack** (meshoptimizer) | **Blender, headless** (`blender -b -P script.py` or `bpy`) |
|---|---|---|---|
| Version | 4.5.1 | 1.3 (2026-09-25) | 5.3.0 / 5.2.4 LTS |
| Simplifier | meshoptimizer `simplify` through WASM, **positions only**; welds first ([simplify.ts][gt-simplify]) | meshoptimizer native; **attribute-aware by default** (normals, colors), optional permissive mode `-sp`, sloppy mode `-sa` ([mesh.cpp][gp-mesh], [v0.25 notes][mo-025]) | Decimate modifier (Collapse): quadric edge collapse that interpolates UVs ([manual][bl-decimate], [source][bl-decimate-src]) |
| UV seams | Preserved: split vertices limit the simplifier | Preserved. With `-sp`, UV discontinuities are explicitly protected | Depends on how the GLB is imported (see §4) |
| Texture resize | Yes: `resize` / `textureCompress({ resize })`, Lanczos3 through sharp ([CLI][gt-cli-src], [texture-compress.ts][gt-tc]) | Only while re-encoding: `-tl N` / `-ts R` apply when textures are converted with `-tw` (WebP) or `-tc` (KTX2). In raw mode, PNG/JPEG are copied unchanged ([encodewebp.cpp][gp-webp], [write.cpp][gp-write]) | Yes: `bpy.types.Image.scale()` ([API][bl-img]) |
| Texture formats | JPEG, PNG, WebP, AVIF through sharp (in-process); KTX2 through an external `ktx` binary, **KTX-Software ≥ 4.4.0** ([toktx.ts][gt-toktx]) | WebP (`-tw`), KTX2/BasisU ETC1S (`-tc`) or UASTC (`-tu`), all built into the native binary ([gltfpack README][gp-readme], [encodebasis.cpp][gp-basis]) | PNG, JPEG, WebP. 5.3 can also create KTX alongside ([manual][bl-gltf]) |
| Geometry compression | meshopt (default in `optimize`), Draco, quantization ([CLI][gt-cli-src]) | Quantization by default, meshopt with `-c` / `-cc` / `-cz` ([gltfpack.cpp][gp-cpp]) | Draco. **5.3 adds meshopt export** (`export_meshopt_compression_enable`) ([API][bl-export]) |
| Speed (qualitative) | JS plus WASM. The `simplify` call is synchronous and blocks the event loop while it runs. Texture work goes through libvips (native). | Native C++. Texture encoding is multi-threaded (`-tj N`). The README says native binaries "run faster" than the npm (WASM) build. | Slowest: process start-up plus the glTF importer and exporter, which are written in Python ([glTF-Blender-IO][bl-io]) |
| Large inputs | Whole GLB held in memory. `textureCompress` refuses images above sharp's limit of 268,402,689 px (0x3FFF²) by default (`limitInputPixels`), so 8K works and 16K or larger fails ([sharp][sharp-limit]) | "Native binaries are recommended over npm since they can work with larger files" ([README][gp-readme]) | Holds the full scene in memory |
| Docker footprint | npm packages plus sharp, which Payload already ships. Works on Alpine. Add a KTX-Software package only if you need KTX2. | One ~2 MB zip (`gltfpack-ubuntu.zip`, glibc) ([release assets][mo-13]). The npm WASM build runs anywhere but cannot compress textures. | 385–407 MB compressed Linux tarball ([5.2][bl-dl52], [5.3][bl-dl53]), or the `bpy` wheel (428 MB, Python 3.13 only, manylinux_2_28) ([PyPI][bpy]) |
| Runs inside Payload? | Yes, as a library in a task handler. Not advisable in the web process (memory, blocked event loop). | Yes: spawn the binary with `child_process` from a task handler | Yes: spawn `blender -b` from a task handler. Big image. |

### 3.2 glTF Transform

- **`optimize`** runs, in this order: dedup → instance → palette → flatten → join → **weld → simplify** → resample → prune → sparse → **texture compression** → **mesh compression**. The defaults are `--compress meshopt`, `--texture-compress auto` ("recompresses in original format") and `--texture-size 2048` ([cli.ts][gt-cli-src]).
- **`simplify` defaults are very conservative for a Preview:** `ratio: 0.0`, `error: 0.0001` (0.01 % of mesh radius), `lockBorder: false`. The ratio is applied to the index count, so it counts triangles ([simplify.ts][gt-simplify]). A Preview needs an explicit, much larger error budget, for example 0.001–0.01.
- **How it simplifies:** it calls meshoptimizer's `simplify` with **index and POSITION data only**, after running `weld()` internally. The doc comment warns: "Topology, particularly split vertices, will also limit the simplifier." It has no attribute weighting and no permissive mode ([simplify.ts][gt-simplify]).
- **Textures:** `textureCompress({ encoder: sharp, targetFormat: 'webp' | 'avif' | 'jpeg' | 'png', resize: [w, h] })` runs in-process. KTX2 (`etc1s` / `uastc`) instead shells out to `ktx create` and checks for KTX-Software 4.4.0 or newer ([toktx.ts][gt-toktx]). It is the only one of the three tools that can **downsize textures and keep them as JPEG/PNG**, which matters if [#14](https://github.com/Bene97Kiel/vimu_payload/issues/14) rules out WebP and KTX2.
- **Fit for this repo:** it is TypeScript-native and uses sharp, which Payload already depends on. Note that the CLI 4.5.1 pins `sharp ~0.35.3` while this repo uses `sharp 0.34.2`. Using the library packages and passing the app's own `sharp` as `encoder` avoids installing two copies. It also wraps the Khronos glTF-Validator (`validate`), which is useful for the "server validates the GLB" step decided in #10.

### 3.3 gltfpack

- **Relevant flags** ([gltfpack.cpp help][gp-cpp]):
  - `-si R`: target triangle ratio.
  - `-se E`: error limit, default 0.01 (1 % deviation).
  - `-sp`: "permissive simplification mode to allow simplification across attribute discontinuities".
  - `-sa`: "aggressively simplify to the target ratio disregarding quality".
  - `-sv`: since 1.3, also moves vertex positions and attributes to optimal values ([v1.3 notes][mo-13]).
  - `-tw`: WebP.
  - `-tc`: KTX2/BasisU.
  - `-tu`: UASTC.
  - `-tq N`: quality 1–10, default 8.
  - `-tl N`: maximum texture dimension.
  - `-tj N`: encoder threads.
  - `-c` / `-cc` / `-cz`: meshopt compression.
  - `-noq`: disable quantization.
  - `-r file`: JSON report.
- **Attribute-aware simplification is on by default since 0.25.** Permissive mode arrived in 0.25 "as a much higher quality alternative to aggressive simplification" ([v0.25][mo-025]), and the library declared it stable in 1.3 ([v1.3][mo-13]).
- **Seams in the code:** gltfpack weights normals 0.5 and colors 1.0. UVs only count in the error metric with `-sv`. In permissive mode it marks every vertex where UVs differ at the same position with `meshopt_SimplifyVertex_Protect`, commented `// protect UV discontinuities`. Separately, it splits and later re-merges vertices on UV-mirror edges. `-sa` falls back to `meshopt_simplifySloppy`, which "breaks attribute discontinuities" ([mesh.cpp][gp-mesh]).
- **Texture resizing is tied to re-encoding.** `-tl` / `-ts` are applied inside the WebP and BasisU encoders. In raw mode the original image bytes are written unchanged ([encodewebp.cpp][gp-webp], [encodebasis.cpp][gp-basis], [write.cpp][gp-write]). A gltfpack Preview therefore uses WebP or KTX2 textures. That fits `<model-viewer>`, which supports WebP through the browser and KTX2 through a transcoder, but the final format choice belongs to [#14](https://github.com/Bene97Kiel/vimu_payload/issues/14).
- **Build:** the native binaries from the GitHub releases include texture compression. A self-built gltfpack needs `MESHOPT_GLTFPACK_BASISU_PATH` and `MESHOPT_GLTFPACK_LIBWEBP_PATH` ([README][gp-readme]). Linux binaries "are now built on older Ubuntu versions to improve glibc compatibility" ([v0.25][mo-025]), so they need glibc.

### 3.4 Headless Blender

- Run with `blender --background --factory-startup -noaudio --python preview.py` ([CLI arguments][bl-args]), or use `import bpy` from the PyPI wheel, which supports only Python 3.13 ([PyPI][bpy]).
- **Pipeline:** `bpy.ops.import_scene.gltf(merge_vertices=…)` → Decimate (Collapse, `ratio`) → `Image.scale()` → `bpy.ops.export_scene.gltf(export_image_format='WEBP', export_image_quality=…, export_draco_mesh_compression_enable=… | export_meshopt_compression_enable=…)` ([import API][bl-import], [export API][bl-export], [Image API][bl-img]).
- **What only Blender can do here: re-unwrap and bake.** You can decimate hard (or remesh), create a new UV layout, and bake the Game asset's texture onto the low-poly mesh with Cycles ("selected to active"). This escapes the UV-seam limit entirely and gives the best texture-to-triangle ratio. It costs a scripted bake setup, minutes of CPU per Scan, and a dependency of 400 MB or more. RealityScan and Metashape do the same thing internally when you simplify and retexture there (§2). meshoptimizer 1.3 added an experimental voxel remesher with an online "remesh→simplify→unwrap→retexture" demo ([v1.3][mo-13]). The release notes do not list it as a gltfpack option.

---

## 4. Quality on photogrammetry meshes: UV seams and texture detail

- **Why seams matter.** glTF stores a UV seam as two vertices at the same position with different UVs. meshoptimizer's default simplifier "follows the topology of the original mesh in an attempt to preserve attribute seams". For "meshes with inconsistent topology or many seams" it can get "stuck", and it is "not guaranteed to reach the target index count" ([meshoptimizer README][mo-readme]). Photogrammetry atlases consist of many islands, so they have many seams. This is the main reason the requested ratio may not be reached at an acceptable error. That is my inference; the README does not mention photogrammetry.
- **Texture detail.** The README says that with seams preserved, "simplification generally preserves texture quality reasonably well by default". Including UVs in the metric is optional, with a suggested weight of around 10–100 ([meshoptimizer README][mo-readme]). The simplifier keeps the existing UVs. Texture detail is lost mainly through **texture downsizing** (8K → 2K), not through the mesh. Fewer triangles stretch each chart over larger triangles, so expect some UV distortion inside charts at very low counts.
- **Escape hatches and their cost:**
  - **Permissive mode** relaxes seams "when the resulting error is acceptable" ([README][mo-readme]). But gltfpack's `-sp` *protects* UV discontinuities ([mesh.cpp][gp-mesh]), so on a mesh whose only discontinuities are UV seams it should behave much like the default mode. This is an inference; #18 should test it.
  - **Sloppy mode** (`-sa`) "doesn't preserve attribute seams or borders" and gives "poor attribute quality" ([README][mo-readme]). Textures smear across chart borders. Do not use it for textured Scans.
  - **Blender's Decimate:**
    - With `merge_vertices=False` (the default), each UV island is a separate piece of mesh. Island borders are weighted as boundaries (`BOUNDARY_PRESERVE_WEIGHT 100`) but decimated independently on each side, so cracks between islands are possible.
    - With `merge_vertices=True`, seams become per-corner UV data. The collapse code interpolates them, and its seam check is compiled out ("Disable seam check … its not really that important"), so smearing at seams is possible ([decimate source][bl-decimate-src], [import option][bl-gltf]).
    - Both points come from reading the code and were not measured.
  - **Re-bake** (Blender, or the Provider's photogrammetry tool) is the only route that removes the seam limit (§3.4).
- **Conclusion for #18:** test gltfpack with `-si` and the default error on 2–3 real Scans. Record the triangle count it reaches, its runtime, its peak memory, and how it looks on a phone. If it cannot reach the budget without visible damage, the options are the Provider-uploaded Preview, which is already allowed by #10, or adding a Blender re-bake worker later.

---

## 5. Where the work runs: Payload Jobs

From the Payload docs ([Queues][pl-queues], [Tasks][pl-tasks]):

- Jobs can run through `autoRun` (cron inside the server), the `/api/payload-jobs/run` endpoint, `payload.jobs.run()`, or the **bin script** with `--cron`, `--queue`, `--limit`, `--all-queues` and `--handle-schedules`. The docs recommend the bin script for dedicated servers: it "creates a completely separate process from your Next.js server".
- Tasks have `retries`, `onFail`, `onSuccess` and input/output schemas, and should be idempotent. A **`concurrency`** key, which requires `jobs.enableConcurrencyControl: true`, controls how jobs with the same key are handled. Keying on the Scan id stops two jobs from processing the same Scan when a Provider replaces it quickly.
- The docs mention **no job timeout**, so the task must set its own timeouts on the child processes (gltfpack, Chromium).
- A handler can be a file path, for tasks with heavy dependencies that run in a separate process, but the docs warn this "may require a sophisticated build pipeline".

**Recommendation:**

1. A `scans` queue with one workflow, `generateRenditions(scanId)`, made of these steps:
   1. Download the Game asset from the object store to a temporary directory.
   2. Read its JSON chunk to get triangle and texture counts and work out `-si`.
   3. Run `gltfpack`.
   4. Render the Poster with Playwright.
   5. Upload the Preview and Poster.
   6. Set the Scan status to ready.
2. A **`worker` service** in docker compose: same repo and env, a glibc base image (for example `mcr.microsoft.com/playwright:v1.xx-noble`, which ships Ubuntu 24.04, Node.js and the browsers with their system dependencies ([Playwright Docker][pw-docker], [Dockerfile][pw-dockerfile])), plus the gltfpack binary. Its command is `payload jobs:run --cron "* * * * *" --queue scans`. The web container keeps `autoRun` off for this queue.
3. A Provider's upload hook only **queues** the job. This keeps the standing preference that "file bytes never flow through an app server": only the worker moves bytes, between the object store and its temporary disk.

Running in-process in the Next.js container is possible for gltf-transform and for a spawned gltfpack, but it is a poor fit. A 500 MB GLB plus 256 MiB per decoded 8K texture makes the web container's memory spike, and glTF Transform's synchronous simplify call freezes the API and the admin UI while it runs.

---

## 6. Poster: rendering headlessly

| Option | Renderer | Dependencies | Looks like the app? | Notes |
|---|---|---|---|---|
| **Playwright + `<model-viewer>`** (recommended) | three.js WebGL in Chromium, on the CPU through SwiftShader | Playwright image or `playwright install --with-deps chromium`. Debian 12/13 or Ubuntu 22.04/24.04/26.04 only, no Alpine ([system requirements][pw-intro]) | **Yes**: the same web component that `model_viewer_plus` embeds | Uses the Preview, so all of its compression extensions decode as on the phone |
| F3D `--output poster.png` | VTK, OpenGL through EGL or OSMesa (`--rendering-backend egl\|osmesa` "to force headless rendering") ([F3D options][f3d-opts]) | f3d binary plus Mesa or EGL | No | glTF and GLB through its native reader, with Draco variants listed. Meshopt, KTX2 and WebP are not documented ([F3D formats][f3d-formats]), so it would have to render the Game asset |
| Blender Cycles, `-b` | CPU path tracer | 400 MB+ (§3) | No (best image quality) | EEVEE historically needs a display even in background mode ([Blender devtalk][bl-eevee]). Current 5.x behaviour is not verified; Cycles has no such requirement. Only worth it if Blender is in the image anyway |
| three.js in Node + `headless-gl` | Mesa llvmpipe | Xvfb plus Mesa. WebGL2 is "implemented" but not conformance-tested ([headless-gl][hgl]) | Partly | Needs DOM shims for texture loading; fragile |

**How the recommended option works:**

- `<model-viewer>` has `toBlob({ mimeType, qualityArgument, idealAspect })`. Per its docs, `idealAspect` makes the blob use the model's ideal aspect ratio, which "allows for easy poster creation". Defaults are "neutral" lighting when no `environment-image` is set, `tone-mapping` "neutral", and `field-of-view` "auto". The `load` event fires "after the first render frame" ([model-viewer docs][mv-docs]).
- The generated image can also feed model-viewer's own `poster` attribute in the app ("Displays an image instead of the model … before a model is loaded") ([model-viewer docs][mv-docs]).
- Chromium no longer falls back to SwiftShader automatically: "WebGL context creation will soon fail instead of falling back to SwiftShader". The opt-in is `--use-gl=angle --use-angle=swiftshader-webgl --enable-unsafe-swiftshader`, and the mode "is not intended for running untrusted content" ([Chromium SwiftShader doc][cr-swiftshader]). Playwright passes `--enable-unsafe-swiftshader` by default ([chromiumSwitches.ts][pw-switches]).

**Sketch:** serve a local `poster.html` that loads a **locally bundled** `model-viewer` and its decoders, not the Google CDN. Then:

```ts
// Inside a Payload task, in the worker container
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } })
await page.goto(`http://127.0.0.1:${port}/poster.html?src=${encodeURIComponent(previewUrl)}`)
await page.waitForFunction(() => (window as any).posterReady === true, null, { timeout: 60_000 }) // set on 'load'
const bytes = await page.evaluate(async () => {
  const mv = document.querySelector('model-viewer') as any
  const blob: Blob = await mv.toBlob({ mimeType: 'image/webp', qualityArgument: 0.9, idealAspect: true })
  return Array.from(new Uint8Array(await blob.arrayBuffer()))
})
await browser.close()
```

**Security note.** The GLB is Provider-supplied, which is semi-trusted, and the SwiftShader opt-in is meant for trusted content. Validate the GLB first, and run Chromium as a non-root user with the seccomp profile, as Playwright recommends for anything but trusted code ([Playwright Docker][pw-docker]). Keep the poster page's network access limited to localhost.

**Camera and orientation.** Photogrammetry exports often have an arbitrary up-axis and pivot. The Poster uses model-viewer's default orbit, so a badly oriented Scan gives a badly framed Poster. Either check orientation during validation or let Providers set `camera-orbit` in the admin. This connects to the "Posters rendered automatically or uploaded" open point on #9.

---

## 7. Proposed Preview command (starting point for #18)

```sh
# R = targetTriangles / inputTriangles, from the GLB JSON chunk (accessor counts)
gltfpack -i game.glb -o preview.glb \
  -si "$R" -se 0.01 \
  -tw -tl 2048 -tq 8 -tj 4 \
  -cc \
  -r report.json
# Variants to compare: -sp ; -sv ; -tc (KTX2/ETC1S) instead of -tw ; -tl 1024
```

Budgets (triangles, texture size) and the allowed extensions (meshopt, KTX2, WebP) come from [#14](https://github.com/Bene97Kiel/vimu_payload/issues/14). If #14 allows only JPEG/PNG textures, use glTF Transform instead (`weld` → `simplify` with an explicit error → `textureCompress({ targetFormat: 'jpeg', resize: [2048, 2048] })` → `meshopt` or `quantize`).

## 8. Open points handed on

- **#18:** for each candidate setting, measure the reachable triangle count, wall time, peak RSS and on-phone look on 2–3 real Scans (one per tool, if possible).
- **#14:** decides which extensions the Preview may use, and that decides between gltfpack (WebP or KTX2) and glTF Transform (JPEG).
- The current `Dockerfile` is Alpine, so the worker needs its own Debian or Ubuntu image (or a multi-target Dockerfile).
- Multi-texture inputs (RealityScan tiles, Metashape pages) stay multi-texture after gltfpack or glTF Transform. Only a re-bake merges them into one atlas.

---

## Sources

- `gt-cli`: https://gltf-transform.dev/cli (glTF Transform CLI docs, v4.5.0 page)
- `gt-cli-src`: https://github.com/donmccurdy/glTF-Transform/blob/main/packages/cli/src/cli.ts
- `gt-simplify`: https://github.com/donmccurdy/glTF-Transform/blob/main/packages/functions/src/simplify.ts
- `gt-tc`: https://github.com/donmccurdy/glTF-Transform/blob/main/packages/functions/src/texture-compress.ts
- `gt-toktx`: https://github.com/donmccurdy/glTF-Transform/blob/main/packages/cli/src/transforms/toktx.ts
- `npm-gt`: https://www.npmjs.com/package/@gltf-transform/cli
- `gp-readme`: https://github.com/zeux/meshoptimizer/blob/master/gltf/README.md
- `gp-cpp`: https://github.com/zeux/meshoptimizer/blob/master/gltf/gltfpack.cpp
- `gp-mesh`: https://github.com/zeux/meshoptimizer/blob/master/gltf/mesh.cpp
- `gp-webp`: https://github.com/zeux/meshoptimizer/blob/master/gltf/encodewebp.cpp
- `gp-basis`: https://github.com/zeux/meshoptimizer/blob/master/gltf/encodebasis.cpp
- `gp-write`: https://github.com/zeux/meshoptimizer/blob/master/gltf/write.cpp
- `mo-readme`: https://github.com/zeux/meshoptimizer/blob/master/README.md (Simplification sections)
- `mo-025`: https://github.com/zeux/meshoptimizer/releases/tag/v0.25
- `mo-13`: https://github.com/zeux/meshoptimizer/releases/tag/v1.3
- `bl-gltf`: https://docs.blender.org/manual/en/latest/addons/scene_gltf2.html (Blender 5.3 manual)
- `bl-export`: https://docs.blender.org/api/current/bpy.ops.export_scene.html
- `bl-import`: https://docs.blender.org/api/current/bpy.ops.import_scene.html
- `bl-img`: https://docs.blender.org/api/current/bpy.types.Image.html
- `bl-decimate`: https://docs.blender.org/manual/en/latest/modeling/modifiers/generate/decimate.html
- `bl-decimate-src`: https://projects.blender.org/blender/blender/src/branch/main/source/blender/bmesh/tools/bmesh_decimate_collapse.cc
- `bl-args`: https://docs.blender.org/manual/en/latest/advanced/command_line/arguments.html
- `bl-dl52`: https://download.blender.org/release/Blender5.2/
- `bl-dl53`: https://download.blender.org/release/Blender5.3/
- `bpy`: https://pypi.org/project/bpy/
- `bl-io`: https://github.com/KhronosGroup/glTF-Blender-IO
- `bl-eevee`: https://devtalk.blender.org/t/blender-2-8-unable-to-open-a-display-by-the-rendering-on-the-background-eevee/1436 (Blender developer statement; dated, 2.8 era)
- `pl-queues`: https://payloadcms.com/docs/jobs-queue/queues
- `pl-tasks`: https://payloadcms.com/docs/jobs-queue/tasks
- `mv-docs`: https://modelviewer.dev/docs/ (content from https://modelviewer.dev/data/docs.json)
- `cr-swiftshader`: https://chromium.googlesource.com/chromium/src/+/main/docs/gpu/swiftshader.md
- `pw-switches`: https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/server/chromium/chromiumSwitches.ts
- `pw-docker`: https://playwright.dev/docs/docker
- `pw-dockerfile`: https://github.com/microsoft/playwright/blob/main/utils/docker/Dockerfile.noble
- `pw-intro`: https://playwright.dev/docs/intro
- `f3d-opts`: https://f3d.app/docs/next/user/OPTIONS
- `f3d-formats`: https://f3d.app/docs/next/user/SUPPORTED_FORMATS
- `hgl`: https://github.com/stackgl/headless-gl
- `sharp-limit`: https://sharp.pixelplumbing.com/api-constructor
- `rs-export`: https://rshelp.capturingreality.com/en-US/tools/export.htm
- `ms-23`: https://www.agisoft.com/pdf/metashape_2_3_en.pdf (Standard Edition 2.3)
- `pc-basic`: https://poly.cam/pricing/basic-plan
- `pc-blog`: https://poly.cam/blog/obj-vs-fbx-vs-glb-which-3d-scan-format-should-you-export
- `kiri-formats`: https://www.kiriengine.app/features/export-formats
- `kiri-quality`: https://www.kiriengine.app/features/export-quality

[gt-cli]: https://gltf-transform.dev/cli
[gt-cli-src]: https://github.com/donmccurdy/glTF-Transform/blob/main/packages/cli/src/cli.ts
[gt-simplify]: https://github.com/donmccurdy/glTF-Transform/blob/main/packages/functions/src/simplify.ts
[gt-tc]: https://github.com/donmccurdy/glTF-Transform/blob/main/packages/functions/src/texture-compress.ts
[gt-toktx]: https://github.com/donmccurdy/glTF-Transform/blob/main/packages/cli/src/transforms/toktx.ts
[npm-gt]: https://www.npmjs.com/package/@gltf-transform/cli
[gp-readme]: https://github.com/zeux/meshoptimizer/blob/master/gltf/README.md
[gp-cpp]: https://github.com/zeux/meshoptimizer/blob/master/gltf/gltfpack.cpp
[gp-mesh]: https://github.com/zeux/meshoptimizer/blob/master/gltf/mesh.cpp
[gp-webp]: https://github.com/zeux/meshoptimizer/blob/master/gltf/encodewebp.cpp
[gp-basis]: https://github.com/zeux/meshoptimizer/blob/master/gltf/encodebasis.cpp
[gp-write]: https://github.com/zeux/meshoptimizer/blob/master/gltf/write.cpp
[mo-readme]: https://github.com/zeux/meshoptimizer/blob/master/README.md
[mo-025]: https://github.com/zeux/meshoptimizer/releases/tag/v0.25
[mo-13]: https://github.com/zeux/meshoptimizer/releases/tag/v1.3
[bl-gltf]: https://docs.blender.org/manual/en/latest/addons/scene_gltf2.html
[bl-export]: https://docs.blender.org/api/current/bpy.ops.export_scene.html
[bl-import]: https://docs.blender.org/api/current/bpy.ops.import_scene.html
[bl-img]: https://docs.blender.org/api/current/bpy.types.Image.html
[bl-decimate]: https://docs.blender.org/manual/en/latest/modeling/modifiers/generate/decimate.html
[bl-decimate-src]: https://projects.blender.org/blender/blender/src/branch/main/source/blender/bmesh/tools/bmesh_decimate_collapse.cc
[bl-args]: https://docs.blender.org/manual/en/latest/advanced/command_line/arguments.html
[bl-dl52]: https://download.blender.org/release/Blender5.2/
[bl-dl53]: https://download.blender.org/release/Blender5.3/
[bpy]: https://pypi.org/project/bpy/
[bl-io]: https://github.com/KhronosGroup/glTF-Blender-IO
[bl-eevee]: https://devtalk.blender.org/t/blender-2-8-unable-to-open-a-display-by-the-rendering-on-the-background-eevee/1436
[pl-queues]: https://payloadcms.com/docs/jobs-queue/queues
[pl-tasks]: https://payloadcms.com/docs/jobs-queue/tasks
[mv-docs]: https://modelviewer.dev/docs/
[cr-swiftshader]: https://chromium.googlesource.com/chromium/src/+/main/docs/gpu/swiftshader.md
[pw-switches]: https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/server/chromium/chromiumSwitches.ts
[pw-docker]: https://playwright.dev/docs/docker
[pw-dockerfile]: https://github.com/microsoft/playwright/blob/main/utils/docker/Dockerfile.noble
[pw-intro]: https://playwright.dev/docs/intro
[f3d-opts]: https://f3d.app/docs/next/user/OPTIONS
[f3d-formats]: https://f3d.app/docs/next/user/SUPPORTED_FORMATS
[hgl]: https://github.com/stackgl/headless-gl
[sharp-limit]: https://sharp.pixelplumbing.com/api-constructor
[rs-export]: https://rshelp.capturingreality.com/en-US/tools/export.htm
[ms-23]: https://www.agisoft.com/pdf/metashape_2_3_en.pdf
[pc-basic]: https://poly.cam/pricing/basic-plan
[pc-blog]: https://poly.cam/blog/obj-vs-fbx-vs-glb-which-3d-scan-format-should-you-export
[kiri-formats]: https://www.kiriengine.app/features/export-formats
[kiri-quality]: https://www.kiriengine.app/features/export-quality
