# PROTOTYPE: Is a generated Preview good enough on a real phone?

Throwaway code for [#18](https://github.com/Bene97Kiel/vimu_payload/issues/18) (map [#9](https://github.com/Bene97Kiel/vimu_payload/issues/9)). Not production code; the verdict lives in the issue.

## What it does

- `generate.mjs` builds ten Preview variants of one Scan with gltfpack 1.3 (npm/WASM) and glTF Transform 4.5. Each variant runs in its own process, so `out/<id>.json` records triangles, file size, build time and peak RAM.
- `serve.mjs` serves `index.html` on port 8018 to a phone on the same Wi-Fi. The page uses the same `<model-viewer>` 3.2.0 bundle the collector app ships (`model_viewer_plus` 1.7.2). It measures load time (from setting `src` to the `load` event) and frame rate (5 s while auto-rotating), and lets you rate each variant and render a Poster. Every measurement and rating is appended to `results.jsonl`.

## Run it

```bash
npm install --ignore-scripts --legacy-peer-deps   # model-viewer 3.2.0 ships a broken postinstall
node generate.mjs path/to/scan.glb                # default: ../../../Objects/Amphora/amphora_gltf.glb
node serve.mjs                                    # then open http://<LAN IP>:8018/ on the phone
```

## Results from 2026-11-15

`results/variants.json` (server side) and `results/results.jsonl` (phone side; Samsung with a Mali-G77 GPU, Samsung Internet on Chromium 143).

Verdict: use gltfpack permissive mode (`-sp`) on the Game asset as uploaded, keeping its normals, then a 2048 JPEG and Draco (variant A). See #18 for the full reasoning.
