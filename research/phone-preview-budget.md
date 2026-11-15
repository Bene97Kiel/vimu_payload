# How heavy can a Preview be on common phones?

Research for [#14](https://github.com/Bene97Kiel/vimu_payload/issues/14), part of the map [#9](https://github.com/Bene97Kiel/vimu_payload/issues/9). Written 2026-11-15. Terms follow `GLOSSARY.md` (Scan, Preview, Game asset, Poster).

## Short answer

The collector app pins `model_viewer_plus` **1.7.2**. That version ships `<model-viewer>` **3.2.0**, which is built on three.js **r154**, as a local asset. The viewer can decode Draco, KTX2/Basis, WebP, AVIF and quantized meshes. Meshopt only works once we configure a decoder URL, and nothing in the app does that today. The Draco and KTX2 decoders are fetched at runtime from Google's CDN (`www.gstatic.com`), not from the app bundle.

No platform documents a hard memory limit for a WebView. Published asset guidance from Google, Apple and Khronos agrees on about **100k triangles, 2048×2048 textures and a few MB** for one model on a phone.

**Proposed Preview budget** (my synthesis of those sources, to be checked on real devices by the Preview prototype):

| | Target | Hard max |
|---|---|---|
| Triangles | ≤ 50,000 | 100,000 |
| Meshes / materials | 1 mesh, 1 opaque material | 1 material |
| Base colour texture | 2048×2048 JPEG | 2048×2048 |
| Other texture maps | none (a normal map at most 1024×1024, only if the prototype shows it's needed) | 1 extra map |
| Geometry compression | Draco (`KHR_draco_mesh_compression`) | Use Draco, or no decoder at all (only `KHR_mesh_quantization`) |
| Not allowed in a Preview | meshopt (until a decoder is configured), `KHR_meshopt_compression`, KTX2 (not needed at this size), animations | |
| GLB file size | ≤ 3 MB | 5 MB |
| Estimated GPU memory | ~25 MB | ~60 MB |

iOS AR needs a USDZ file **and** a context where AR Quick Look works. Inside the app's WKWebView, that in practice means a USDZ hosted on the server and passed as `iosSrc`. The details are in the iOS AR section below.

## 1. What the app actually runs

Everything in this section was checked against the code: the collector app and the `model_viewer_plus-1.7.2` package in the local pub cache.

- `collector_app/pubspec.yaml` asks for `model_viewer_plus: ^1.7.2`, and `pubspec.lock` resolves it to **1.7.2**. `webview_flutter` is 4.8.0.
- The viewer is used in one place: `lib/views/valuable/object_preview_page.dart`. It renders `ModelViewer(src: mediaFileUrl, ar: false, autoRotate: true, cameraControls: true)`. It is opened from three pages, one model at a time. Lists don't render 3D, which fits #10's Poster decision.
- The package bundles `assets/model-viewer.min.js` (887 KB). The changelog's last upgrade before 1.7.x is *"Upgrade <model-viewer> to v3.2.0"* (1.5.1). The bundle contains three.js `REVISION "154"`, and model-viewer 3.2.0's `package.json` peers `three ^0.154.0` ([source](https://github.com/google/model-viewer/blob/v3.2.0/packages/model-viewer/package.json)).
- **How it loads on Android and iOS** (`lib/src/model_viewer_plus_mobile.dart`): the widget starts an HTTP server on `127.0.0.1:<random port>`. That server serves the HTML page and `model-viewer.min.js` from app assets. The model is requested as `/model`, and the server answers with a redirect to the real `src` URL. So the page's origin is `http://127.0.0.1:<port>`, and the Preview is a **cross-origin fetch**. The package README says the model *"must be served with a `Access-Control-Allow-Origin: *` HTTP header"*. **Consequence for the object store ticket:** the public bucket holding Previews needs CORS `Access-Control-Allow-Origin: *`.
- The local server answers only `/`, `/index.html`, `/model-viewer.min.js` and `/model`. Any other relative path is redirected to the model's origin. Decoders therefore cannot be bundled in the app without forking the package. They can be pointed at our own host (see §3).
- `ar: false` today. The widget doesn't handle a WebView renderer being killed: there is no `onRenderProcessGone` or `webViewWebContentProcessDidTerminate` handling.
- Newer versions exist. `model_viewer_plus` **1.10.0** (published ~late 2025) ships model-viewer **4.1.0**, which is built on three `^0.172.0` ([pub.dev changelog](https://pub.dev/packages/model_viewer_plus/changelog), [model-viewer 4.1.0 package.json](https://github.com/google/model-viewer/blob/v4.1.0/packages/model-viewer/package.json)). 1.10.0 requires Dart ^3.10. Upgrading doesn't change the budget below, and the budget is written to work on 1.7.2.

## 2. Which compression formats are supported

These results come from grepping the bundled `model-viewer.min.js` (three r154 GLTFLoader) and from the model-viewer docs.

| Format | glTF extension | Bundled viewer (1.7.2) | Decoder needed | Default decoder location |
|---|---|---|---|---|
| Draco geometry | `KHR_draco_mesh_compression` | Yes | `draco_wasm_wrapper.js` + `draco_decoder.wasm` (or `draco_decoder.js` fallback) | `https://www.gstatic.com/draco/versioned/decoders/1.5.6/` |
| Meshopt geometry | `EXT_meshopt_compression` | Only if `meshoptDecoderLocation` is set | `meshopt_decoder.js` (loaded as a `<script>`, must define global `MeshoptDecoder`) | **None**: *"By default, the Meshopt decoder is not enabled"* ([docs.json](https://github.com/google/model-viewer/blob/master/packages/modelviewer.dev/data/docs.json)) |
| Meshopt (Khronos version) | `KHR_meshopt_compression` | **No** (not in the r154 bundle) | n/a | n/a |
| Quantized attributes | `KHR_mesh_quantization` | Yes, natively | none | n/a |
| KTX2 / Basis Universal textures | `KHR_texture_basisu` | Yes | `basis_transcoder.js` + `.wasm` | `https://www.gstatic.com/basis-universal/versioned/2021-04-15-ba1c3e4/` (the current model-viewer master uses `.../1.50.0-three-r183/`) |
| WebP textures | `EXT_texture_webp` | Yes, browser-native | none | n/a. Needs WebP in the WebView: Safari/WebKit added it in Safari 14 ([WebKit](https://webkit.org/blog/11340/new-webkit-features-in-safari-14/)) |
| AVIF textures | `EXT_texture_avif` | Yes, browser-native | none | n/a |

What happens when something is missing (three r154 GLTFLoader, [source](https://github.com/mrdoob/three.js/blob/r154/examples/jsm/loaders/GLTFLoader.js)):

- **Meshopt** without a decoder throws `setMeshoptDecoder must be called before loading compressed files`, so the model doesn't load.
- **WebP** that the browser doesn't support falls back to the non-WebP source if the asset has one. If the extension is required, it throws.
- **Draco** with no reachable decoder fails the load. three raises the error through the loader's error callback.

**gltfpack note.** Its `-c`/`-cc` flags produce `EXT_meshopt_compression`, which needs a decoder. `-cz` / `-ce khr` produce `KHR_meshopt_compression`, which the bundled viewer **cannot read** ([gltfpack README](https://github.com/zeux/meshoptimizer/blob/master/gltf/README.md)). Quantization is on by default in gltfpack and needs no decoder.

## 3. Where decoders come from, and offline behaviour

- **Draco and KTX2 come from Google's CDN by default.** The bundle reads `self.ModelViewerElement.dracoDecoderLocation || "https://www.gstatic.com/draco/versioned/decoders/1.5.6/"`, and the same pattern for KTX2. Meshopt is only wired up if `meshoptDecoderLocation` is set. This matches current master ([loading.ts](https://github.com/google/model-viewer/blob/master/packages/model-viewer/src/features/loading.ts)).
- **Decoders are lazy-loaded.** The model-viewer FAQ says decoder links are only fetched when a model uses that feature. To be self-contained, point the locations at files you host yourself ([faq.json](https://github.com/google/model-viewer/blob/master/packages/modelviewer.dev/data/faq.json)). The docs add that the Draco decoder is *"more than 100KB"* and that the location must be set **before** the first `<model-viewer>` element is created ([loading examples](https://github.com/google/model-viewer/blob/master/packages/modelviewer.dev/examples/loading/index.html)).
- **How to self-host with `model_viewer_plus` 1.7.2 without a fork:** pass `relatedJs: "self.ModelViewerElement = { dracoDecoderLocation: 'https://<our public host>/decoders/draco/1.5.6/' };"`. `html_builder.dart` inserts `relatedJs` as an inline classic `<script>` after the `<model-viewer>` tag. That inline script runs before the deferred `type="module"` script that defines the element. I inferred this ordering from the HTML spec and have **not tested it on a device**. The same technique works for `meshoptDecoderLocation`. The decoder files need CORS too, because they are fetched from the `127.0.0.1` origin.
- **Offline.** The Preview itself comes over the network, so an offline phone can't show a Preview it hasn't cached. With Draco, a phone that has the GLB cached but not the decoder still fails. Decoders sit at versioned URLs and normally end up in the WebView's HTTP cache after the first use. Real offline support would need the decoders inside the app, which 1.7.2's local server can't serve (§1). Offline isn't a v1 requirement.
- **Third-party dependency and privacy.** With the defaults, every first Draco or KTX2 load makes the phone contact `www.gstatic.com`. Self-hosting the decoder removes that runtime dependency on Google and the IP disclosure to a third party. That is worth doing for an EU app, but it is a judgement call, not legal advice.

## 4. Budgets: what primary sources say

| Source | Triangles | Textures | File size | Notes |
|---|---|---|---|---|
| Google Scene Viewer (Android AR) [asset requirements](https://developers.google.com/ar/develop/scene-viewer) | recommended ≤ 100,000; *"30,000 to 50,000 is an ideal range"* | max 2048×2048; JPG preferred without transparency | 10 MB recommended (validator errors above 15 MB) | ≤ 10 materials. Only `KHR_materials_unlit` and `KHR_texture_transform` are listed as supported extensions (Draco, KTX2, WebP and meshopt aren't mentioned) |
| Apple AR Quick Look (Apple engineer, [developer forums, 2021](https://developer.apple.com/forums/thread/693867)) | 100K polygons | one set of 2048×2048 textures | n/a | Aimed at *"all of our supported devices (down to iPhone 7)"*. Newer devices can take more |
| Khronos 3D Commerce guidelines 1.0 ([Publishing Targets](https://github.com/KhronosGroup/3DC-Asset-Creation/blob/main/asset-creation-guidelines-1.0/full-version/sec99_PublishingTargets/PublishingTargets.md), 2020) | Single-item mobile AR / 3D web view: 150,000 | 2K (JPG) | 3 MB | 3 MB ≈ under 3 s at 10 Mbit/s. A preview version often drops the normal map and keeps a low-res base colour plus a simplified mesh. The 2.0 version (Aug 2025) of this section is still marked work in progress |
| OpenGL ES 3.0 / WebGL 2 ([glGet](https://registry.khronos.org/OpenGL-Refpages/es3.0/html/glGet.xhtml)) | n/a | `GL_MAX_TEXTURE_SIZE` *"must be at least 2048"* | n/a | 2048 is the only size the spec guarantees. three r154 resizes larger images on the CPU (`"has been resized from"`) |

**GPU memory arithmetic** (my calculation). JPEG, PNG and WebP textures are decoded to RGBA8 on the GPU, so 4 bytes per pixel plus about ⅓ extra for mipmaps:

| Texture | GPU memory |
|---|---|
| 1024×1024 | ~5.3 MiB |
| 2048×2048 | ~21.3 MiB |
| 4096×4096 | ~85.3 MiB |
| 8192×8192 | ~341 MiB |

The decoded bitmap also briefly exists on the CPU side while it uploads. Geometry is small next to that. 100k triangles with position, normal and UV and about 60k vertices come to roughly 3 MB, even after Draco is decoded back to floats. **Textures are what decide memory use.** Photogrammetry exports often carry 4K–8K textures, so the main job of Preview generation is to downscale the Game asset's textures.

KTX2 cuts GPU memory (Khronos' examples: 96 MB → 21 MB, and *"saves about 82% in GPU memory"*) but barely shrinks the file ([KTX Artist Guide](https://github.com/KhronosGroup/3D-Formats-Guidelines/blob/main/KTXArtistGuide.md)). The model-viewer FAQ calls it the fix when *"Large high-res models ... run out of GPU RAM on mobile devices"*. With one 2048² map the Preview is already small enough, so KTX2 adds a CDN dependency and a transcoder step for little gain in v1.

## 5. WebView memory limits

**Neither platform documents a fixed memory limit for a WebView.** What *is* documented:

**Android WebView**
- On Android 8.0+, WebView renders in a separate, sandboxed renderer process (it may fall back to a single process on low-RAM devices). Most of its memory is native and *"not on the Java heap"*. It isn't capped by the app's `maxHeap`. It *"can silently grow to gigabytes"* until the Low Memory Killer starts killing processes ([Manage and diagnose WebView memory](https://developer.android.com/develop/ui/views/layout/webapps/manage-webview-memory)).
- The **GPU service runs inside the app's own process** (*"WebView runs other services (ex. GPU service, Network Service) in-process on all OS versions"*, [Chromium WebView architecture](https://chromium.googlesource.com/chromium/src/+/HEAD/android_webview/docs/architecture.md)). WebGL textures therefore count against the Flutter app's process, not only the renderer. An oversized Preview can get the whole app killed.
- If the renderer is killed for memory, `onRenderProcessGone` fires with `didCrash() == false`. That WebView can't be reused and must be destroyed and recreated ([Termination Handling API](https://developer.android.com/develop/ui/views/layout/webapps/managing-webview#termination-handle)). `model_viewer_plus` 1.7.2 doesn't handle this.

**iOS WKWebView**
- Web content runs in a separate process. `webViewWebContentProcessDidTerminate` fires when it *"terminates for any reason"* ([Apple](https://developer.apple.com/documentation/webkit/wknavigationdelegate/webviewwebcontentprocessdidterminate(_:))).
- Since iOS 16, WebKit draws page content, 2D canvas *and WebGL* in a separate GPU process ([WebKit, Safari 17](https://webkit.org/blog/14445/webkit-features-in-safari-17-0/)).
- Apple publishes no number for these processes. For apps, Apple says memory limits *"can change during the app life cycle and don't necessarily correspond to the amount of physical memory"* ([os_proc_available_memory](https://developer.apple.com/documentation/os/os_proc_available_memory)). A process over its limit is terminated by the OS.

**Practical reading.** Since there is no number to plan against, the budget keeps the decoded Preview around 25 MB (target) and 60 MB at most. That is far below what any phone sold in the last ~8 years has free for a single foreground view, and it matches Apple's "down to iPhone 7" target. The prototype should still measure renderer and GPU memory on one low-end Android phone (`adb shell dumpsys meminfo`, see the Android page above) and one older iPhone.

## 6. What `<model-viewer>` needs for iOS AR

Based on the model-viewer docs ([docs.json](https://github.com/google/model-viewer/blob/master/packages/modelviewer.dev/data/docs.json)) and the source:

1. Set the `ar` attribute, with `quick-look` in `ar-modes`. The default is `"webxr scene-viewer quick-look"`.
2. **A USDZ file**, provided in one of two ways:
   - `ios-src`: a pre-made USDZ, *"used on supported iOS 12+ devices via AR Quick Look on Safari"*. It must be served as `model/vnd.usdz+zip` ([WebKit](https://webkit.org/blog/8421/viewing-augmented-reality-assets-in-safari-for-ios/)).
   - Or no `ios-src`: model-viewer generates a USDZ on the device when the AR button is pressed (three's `USDZExporter`, present in the bundle). `ar-usdz-max-texture-size` caps its texture size.
3. **A context where AR Quick Look works.** Safari and `SFSafariViewController` support `<a rel="ar">` ([WebKit](https://webkit.org/blog/8421/viewing-augmented-reality-assets-in-safari-for-ios/)). **WKWebView doesn't reliably support it.** WebKit bug 240117: *"AR Quick Look isn't yet supported in WKWebView"* (2022). The bug was still open, unassigned, at its last update in Feb 2024 ([bug](https://bugs.webkit.org/show_bug.cgi?id=240117)). Apple's ARKit article says links work *"within a web view that's displayed in your app"* ([Apple](https://developer.apple.com/documentation/arkit/previewing-a-model-with-ar-quick-look)). The WebKit bug is newer and more specific.
   - model-viewer's own detection matches the bug. Inside a WKWebView (detected as `window.webkit.messageHandlers` existing), it treats Quick Look as unavailable unless the user agent is Chrome, Edge, Firefox, the Google app or DuckDuckGo ([constants.ts](https://github.com/google/model-viewer/blob/master/packages/model-viewer/src/constants.ts); the same logic is in the 3.2.0 bundle).
4. **ARKit hardware:** *"iOS 11.0 or later and an iOS device with an A9 or later processor"* ([Apple](https://developer.apple.com/documentation/arkit/verifying-device-support-and-user-permission)).

**What this means in the Flutter app.** `model_viewer_plus` works around WKWebView: when the WebView tries to navigate to exactly `iosSrc`, it opens that URL with `url_launcher` in `SFSafariViewController`, where Quick Look works. This was added in changelog 1.1.5. The README still warns *"AR View may not avaliable on iOS 16+"*.

So in the app, iOS AR realistically needs **a USDZ hosted on the server at a public URL, passed as `iosSrc`**. A USDZ generated on the device is a `blob:` URL inside the WKWebView, which can't be handed to Safari. I inferred this from the code and **haven't tested it on a device**.

The native alternative is to download the `.usdz` and show it with `QLPreviewController` / `ARQuickLookPreviewItem` ([Apple](https://developer.apple.com/documentation/arkit/previewing-a-model-with-ar-quick-look)) through a platform channel or plugin.

Either way, iOS AR implies a USDZ file the current four-Rendition model doesn't have. That belongs to the map's open item "iOS AR (Quick Look) via USDZ" and is not decided here.

**Android AR, for completeness.** `model_viewer_plus` hands `src` straight to Scene Viewer through an intent. Scene Viewer downloads the file itself. Its asset page lists only `KHR_materials_unlit` and `KHR_texture_transform` as supported extensions. A Draco-compressed Preview *may* not work in Scene Viewer (not tested). If Android AR gets enabled, check this or point AR at an uncompressed variant.

## 7. Recommendation and rationale

1. **Triangles: target 50k, hard max 100k.** Scene Viewer calls 30–50k ideal and ≤100k the recommended limit. Apple's AR Quick Look number is 100k for devices down to iPhone 7. Khronos allows 150k for a single-item mobile view. Starting at 50k leaves headroom on low-end Androids, since Android renders WebGL in the app process.
2. **Textures: one base colour map at 2048×2048 JPEG.** 2048 is the only texture size WebGL 2 guarantees, and it's the cap in Scene Viewer, Apple and Khronos. It costs ~21 MiB of GPU memory. Photogrammetry rarely needs ORM or emissive maps. Khronos suggests previews drop the normal map first. Use JPEG over WebP for v1, because Scene Viewer documents JPG/PNG only. WebP is a safe later size win: the bundled viewer handles it and every supported OS version has it.
3. **Geometry: Draco.** The bundled viewer decodes it **without any app change**. It's the one geometry codec that works out of the box. Meshopt is smaller and faster to decode, but needs `meshoptDecoderLocation` set in the app and a hosted decoder. Do that only if the prototype shows Draco decode time is a problem. If we want zero external dependencies, use quantization only: it needs no decoder and the files are larger. Recommended follow-up: self-host the Draco decoder through `relatedJs` (§3).
4. **File size: target ≤ 3 MB, hard max 5 MB.** 3 MB is the Khronos figure for a mobile 3D view (≈ 2.4 s at 10 Mbit/s). 5 MB stays well under Scene Viewer's 10 MB and keeps the worst case around 4 s.
5. **No KTX2 in v1.** It doesn't save download size, and at one 2048² map the GPU saving isn't needed. It also adds the gstatic transcoder dependency. Revisit if Previews grow to several maps or 4K.
6. **Server-side checks** when generating or accepting a Preview: triangle count, texture dimensions, file size, and the allowed extensions (reject `EXT_meshopt_compression` and `KHR_meshopt_compression` until a decoder is configured).
7. **Object store:** the public Preview bucket must send `Access-Control-Allow-Origin: *` (§1).

## Open points and caveats

- None of the budget numbers were measured on a device. The Preview prototype should load a 50k/2048/Draco Preview and a 100k/2048 one on a low-end Android phone and an older iPhone, and record load time and renderer/GPU memory.
- Two behaviours are inferred from code and spec, not tested: the `relatedJs` ordering for decoder locations (§3), and iOS AR needing `iosSrc` inside the app (§6).
- Whether `window.webkit.messageHandlers` exists in the app's WKWebView depends on whether any script message handler is registered. That changes which branch of model-viewer's Quick Look check runs, but not the WebKit limitation behind it.
- Apple's 100k / 2048 figures come from a 2021 forum answer by an Apple engineer, not a formal spec page. The Khronos table is from 2020, and its successor is unfinished.
- Scene Viewer's supported-extension list may be incomplete; I didn't test Draco in Scene Viewer.

## Sources

- Local code: `collector_app/pubspec.yaml`, `pubspec.lock`, `lib/views/valuable/object_preview_page.dart`. Pub cache `model_viewer_plus-1.7.2`: `assets/model-viewer.min.js`, `assets/template.html`, `lib/src/model_viewer_plus_mobile.dart`, `lib/src/html_builder.dart`, `README.md`, `CHANGELOG.md`.
- model_viewer_plus changelog: https://pub.dev/packages/model_viewer_plus/changelog
- model-viewer 3.2.0 package.json: https://github.com/google/model-viewer/blob/v3.2.0/packages/model-viewer/package.json
- model-viewer 4.1.0 package.json: https://github.com/google/model-viewer/blob/v4.1.0/packages/model-viewer/package.json
- model-viewer docs data: https://github.com/google/model-viewer/blob/master/packages/modelviewer.dev/data/docs.json
- model-viewer FAQ data: https://github.com/google/model-viewer/blob/master/packages/modelviewer.dev/data/faq.json
- model-viewer loading examples: https://github.com/google/model-viewer/blob/master/packages/modelviewer.dev/examples/loading/index.html
- model-viewer `loading.ts`: https://github.com/google/model-viewer/blob/master/packages/model-viewer/src/features/loading.ts
- model-viewer `constants.ts`: https://github.com/google/model-viewer/blob/master/packages/model-viewer/src/constants.ts
- three.js r154 GLTFLoader: https://github.com/mrdoob/three.js/blob/r154/examples/jsm/loaders/GLTFLoader.js
- gltfpack README: https://github.com/zeux/meshoptimizer/blob/master/gltf/README.md
- Khronos KTX Artist Guide: https://github.com/KhronosGroup/3D-Formats-Guidelines/blob/main/KTXArtistGuide.md
- Khronos 3D Commerce Publishing Targets 1.0: https://github.com/KhronosGroup/3DC-Asset-Creation/blob/main/asset-creation-guidelines-1.0/full-version/sec99_PublishingTargets/PublishingTargets.md
- OpenGL ES 3.0 glGet reference: https://registry.khronos.org/OpenGL-Refpages/es3.0/html/glGet.xhtml
- Google Scene Viewer: https://developers.google.com/ar/develop/scene-viewer
- Apple forums, USDZ model sizes: https://developer.apple.com/forums/thread/693867
- Apple, Previewing a model with AR Quick Look: https://developer.apple.com/documentation/arkit/previewing-a-model-with-ar-quick-look
- Apple, Verifying device support (ARKit): https://developer.apple.com/documentation/arkit/verifying-device-support-and-user-permission
- Apple, webViewWebContentProcessDidTerminate: https://developer.apple.com/documentation/webkit/wknavigationdelegate/webviewwebcontentprocessdidterminate(_:)
- Apple, os_proc_available_memory: https://developer.apple.com/documentation/os/os_proc_available_memory
- WebKit, Viewing AR assets in Safari for iOS: https://webkit.org/blog/8421/viewing-augmented-reality-assets-in-safari-for-ios/
- WebKit, Safari 14 features (WebP): https://webkit.org/blog/11340/new-webkit-features-in-safari-14/
- WebKit, Safari 17 features (GPU process): https://webkit.org/blog/14445/webkit-features-in-safari-17-0/
- WebKit bug 240117: https://bugs.webkit.org/show_bug.cgi?id=240117
- Android, Managing WebView objects: https://developer.android.com/develop/ui/views/layout/webapps/managing-webview
- Android, Manage and diagnose WebView memory: https://developer.android.com/develop/ui/views/layout/webapps/manage-webview-memory
- Chromium, Android WebView architecture: https://chromium.googlesource.com/chromium/src/+/HEAD/android_webview/docs/architecture.md
