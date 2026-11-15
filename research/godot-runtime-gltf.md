# What can Godot 4 load at runtime from a GLB?

Research for issue #13 (child of map #9, "Wayfinder: storage and API architecture for Scans").
Researched 2026-11-15.

**Versions examined.** Current stable is **Godot 4.7.2** (released 2026-08-18). `master` is 4.8, which is in beta (4.8-beta3, 2026-11-09). Unless stated otherwise, every claim below comes from reading the 4.7.2-stable source of `modules/gltf` and related engine code, and each was checked against `master`. Godot's glTF module changes often, so re-check these facts when the game moves to a newer engine version.

Scope: runtime loading with `GLTFDocument.append_from_buffer` / `append_from_file` followed by `generate_scene` in an **exported game** (an official export template, i.e. no editor and `TOOLS_ENABLED` off). Editor import is out of scope.

---

## Short answers

| Question | Answer (4.7.2) |
|---|---|
| `KHR_draco_mesh_compression` | **Not supported.** The file is rejected with `ERR_UNAVAILABLE`. Open PR #120205 would add it; it has not been merged and is not in 4.8. |
| `EXT_meshopt_compression` | **Not supported.** If the extension is required, the file is rejected. If it is optional, Godot reads the uncompressed fallback buffer. |
| `KHR_mesh_quantization` | **Not supported.** The spec forces it into `extensionsRequired`, so the file is rejected, even though the accessor decoder already handles normalized integers. Default `gltfpack` output therefore fails. |
| `KHR_texture_basisu` (KTX2) | **Supported.** The texture is transcoded when it loads. Linear maps (normal, ORM) become BC7/BC5/BC4 on desktop. **sRGB maps (base colour) are transcoded to uncompressed RGBA8**, and their colours may come out wrong. |
| `EXT_texture_webp` | **Supported.** The image is decoded to uncompressed RGBA8. WebP only makes the download smaller. |
| VRAM compression at runtime | **Not in official export templates.** PNG/JPEG/WebP textures end up as uncompressed RGBA8 `ImageTexture`s **without mipmaps**. `Image.compress()` returns `ERR_UNAVAILABLE`. `HANDLE_BINARY_IMAGE_MODE_EMBED_AS_BASISU` fails ("editor build only"). Runtime compression is only possible with custom-built export templates. |
| LODs at runtime | **Not generated automatically.** `ImporterMesh.generate_lods()` does work in export templates, so the game can call it itself between `append_from_*` and `generate_scene`. |
| Large meshes, 4K/8K textures | Desktop GPUs can render them. The cost is in the import path: SurfaceTool uses about 170 B per vertex of temporary RAM, the whole GLB sits in memory, and the textures are uncompressed (an 8K texture takes 256 MiB, or 341 MiB with mipmaps). See the budget suggestion in §4. |
| `HTTPRequest` for large downloads | Progress reporting works (`get_downloaded_bytes` / `get_body_size`). **Resuming does not**: a failed or cancelled download deletes the partial `download_file`. Resuming needs Range requests that the game manages itself. Without `use_threads`, throughput is capped at about 64 KiB per frame. The byte counters are 32-bit. |

---

## 1. glTF extensions decoded at runtime

### How Godot decides

- `GLTFDocument` hard-codes the extensions it supports itself: `GODOT_single_root`, `KHR_animation_pointer`, `KHR_lights_punctual`, `KHR_materials_emissive_strength`, `KHR_materials_pbrSpecularGlossiness`, `KHR_materials_unlit`, `KHR_node_visibility`, `KHR_texture_transform`. On top of that it adds whatever each registered `GLTFDocumentExtension` reports from `get_supported_extensions()` ([gltf_document.cpp L6968-L6988](https://github.com/godotengine/godot/blob/4.7.2-stable/modules/gltf/gltf_document.cpp#L6968-L6988)).
- Export templates register these extensions at runtime: physics (`OMI_*`), KTX (`KHR_texture_basisu`), WebP (`EXT_texture_webp`), and the ImporterMesh→MeshInstance3D converter ([register_types.cpp L135-L145](https://github.com/godotengine/godot/blob/4.7.2-stable/modules/gltf/register_types.cpp#L135-L145)).
- If any entry in `extensionsRequired` is missing from that set, parsing fails with `ERR_UNAVAILABLE` and the message *"required extension '…' is not supported. Are you missing a GLTFDocumentExtension plugin?"* ([gltf_document.cpp L7364-L7383](https://github.com/godotengine/godot/blob/4.7.2-stable/modules/gltf/gltf_document.cpp#L7364-L7383)). `master` has the same supported set.

### Per extension

- **KHR_draco_mesh_compression.** Godot has no decoder for it. Draco is always listed in `extensionsRequired`, so such files are rejected. Proposal [godot-proposals#8576](https://github.com/godotengine/godot-proposals/issues/8576) asks for hooks to support it. PR [#120205](https://github.com/godotengine/godot/pull/120205) ("GLTF: Add import support for Draco and meshopt mesh compression", opened 2026-06-11) would add Draco, meshopt and quantization. It is **open and unmerged** (milestone `4.x`, last activity 2026-07-23). A glTF maintainer prefers meshopt to Draco, and a reviewer suggested shipping meshopt only. A third-party GDExtension, [GDDraco](https://github.com/itslebi/GDDraco), exists (mentioned in #8576); we have not evaluated it.
- **EXT_meshopt_compression.** Godot has no decoder for it at runtime. The engine already ships the meshoptimizer library, but only its simplifier functions are wired up ([meshoptimizer/register_types.cpp](https://github.com/godotengine/godot/blob/4.7.2-stable/modules/meshoptimizer/register_types.cpp)). `gltfpack -c` marks the extension as required. With `-cf` it writes an uncompressed fallback, and Godot would read that fallback. Same open PR #120205.
- **KHR_mesh_quantization.** It is not in the supported set. The spec says *"files that use the extension must specify it in `extensionsRequired`"* ([Khronos spec](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_mesh_quantization/README.md)), so Godot always rejects these files. However, `GLTFAccessor` already decodes normalized byte/short components with the core-spec equations ([gltf_accessor.cpp L654-L690](https://github.com/godotengine/godot/blob/4.7.2-stable/modules/gltf/structures/gltf_accessor.cpp#L654-L690)). PR #120205 only adds the extension to the supported list for that reason. *Untested workaround:* register a small `GLTFDocumentExtension` whose `_get_supported_extensions()` returns `"KHR_mesh_quantization"`. Note that `gltfpack` quantizes by default and only stops with `-noq` ([gltfpack README](https://github.com/zeux/meshoptimizer/blob/master/gltf/README.md)).
- **KHR_texture_basisu.** Supported through `GLTFDocumentExtensionTextureKTX`. It handles `image/ktx2` with `Image.load_ktx_from_buffer` ([gltf_document_extension_texture_ktx.cpp L41-L52](https://github.com/godotengine/godot/blob/4.7.2-stable/modules/gltf/extensions/gltf_document_extension_texture_ktx.cpp#L41-L52)). The `ktx` and Basis Universal transcoder modules are built into export templates. Only the Basis *encoder* is limited to the editor (see §2). Transcoding details are in §2.
- **EXT_texture_webp.** Supported. It handles `image/webp` with `Image.load_webp_from_buffer` ([gltf_document_extension_texture_webp.cpp L47-L52](https://github.com/godotengine/godot/blob/4.7.2-stable/modules/gltf/extensions/gltf_document_extension_texture_webp.cpp#L47-L52)).
- Godot also supports none of the following, so a file that requires one of them is rejected: `KHR_meshopt_compression` (emitted by `gltfpack -cz`), `MSFT_lod`, and `EXT_mesh_gpu_instancing`.

**Meaning for us:** the server-side validation of the Game asset (decided in #10) can enforce this directly. It should reject any GLB whose `extensionsRequired` contains something outside Godot's supported set. Draco, meshopt and quantization are the ones that matter in practice. Blender's glTF exporter offers Draco as a checkbox, and `gltfpack` uses quantization by default.

---

## 2. Textures and VRAM compression at runtime

### What happens to PNG / JPEG / WebP in a GLB

1. The image bytes are decoded to an `Image`. Godot first offers them to extensions (KTX, WebP), then tries PNG, then JPEG ([gltf_document.cpp L2150-L2189](https://github.com/godotengine/godot/blob/4.7.2-stable/modules/gltf/gltf_document.cpp#L2150-L2189)).
2. What happens next depends on `GLTFState.handle_binary_image_mode`. The default is `EXTRACT_TEXTURES`, which is documented as editor-only: *"At runtime, this acts the same as `HANDLE_BINARY_IMAGE_MODE_EMBED_AS_UNCOMPRESSED`"* ([GLTFState.xml L310-L347](https://github.com/godotengine/godot/blob/4.7.2-stable/modules/gltf/doc_classes/GLTFState.xml#L310-L347)).
3. In uncompressed mode the decoded image is wrapped as it is with `ImageTexture.set_image(p_image)` ([gltf_document.cpp L2292-L2299](https://github.com/godotengine/godot/blob/4.7.2-stable/modules/gltf/gltf_document.cpp#L2292-L2299)). **Godot does not call `generate_mipmaps()`.** The only `generate_mipmaps()` calls in the module are on the Basis path, for the ORM merge and for spec-gloss conversion. `master` behaves the same. The texture therefore sits in VRAM as uncompressed RGBA8/RGB8 **without mipmaps**, so it aliases and shimmers at a distance. A user report matches this ([forum thread, 4.3](https://forum.godotengine.org/t/not-applied-mipmap-at-gltf-runtime-loaded-model/94799)). The official runtime-loading docs also say to *"make sure to call Image.generate_mipmaps"* for runtime-loaded images ([Runtime file loading and saving](https://docs.godotengine.org/en/stable/tutorials/io/runtime_file_loading_and_saving.html)).
4. `GLTFState` keeps a reference to every decoded `Image` in `source_images`. Drop the `GLTFState` after `generate_scene` so this CPU copy is freed.

**Workaround in the game:** after `append_from_*`, loop over `state.get_images()` / `state.get_source_images()`. Call `generate_mipmaps()` on each image and update the textures before `generate_scene`, or fix up the materials afterwards.

### Why there is no runtime VRAM compression in official templates

- **`Image.compress()`**: the docs say *"only supported in editor builds. When run in an exported project, this method always returns `ERR_UNAVAILABLE`"* ([Image.xml L87](https://github.com/godotengine/godot/blob/4.7.2-stable/doc/classes/Image.xml#L87)). The source confirms it. The S3TC/ETC (etcpak) and ASTC compressors are only registered under `#ifdef TOOLS_ENABLED` ([etcpak/register_types.cpp L41-L45](https://github.com/godotengine/godot/blob/4.7.2-stable/modules/etcpak/register_types.cpp#L41-L45), [astcenc/register_types.cpp L40-L42](https://github.com/godotengine/godot/blob/4.7.2-stable/modules/astcenc/register_types.cpp#L40-L42)). The BC7 (cvtt) and GPU BCn (Betsy) modules are only built for the editor unless the opt-in SCons flags `cvtt_export_templates` / `betsy_export_templates` are set ([cvtt/config.py](https://github.com/godotengine/godot/blob/4.7.2-stable/modules/cvtt/config.py), [betsy/config.py](https://github.com/godotengine/godot/blob/4.7.2-stable/modules/betsy/config.py)). 4.8 adds `etcpak_export_templates` for S3TC/ETC (PR [#121979](https://github.com/godotengine/godot/pull/121979), merged 2026-08-03).
- **`HANDLE_BINARY_IMAGE_MODE_EMBED_AS_BASISU`**: this path calls `PortableCompressedTexture2D.create_from_image(..., BASIS_UNIVERSAL)`. Outside `TOOLS_ENABLED` that call fails with *"Basis Universal compression can only run in editor build."* ([portable_compressed_texture.cpp L194-L202](https://github.com/godotengine/godot/blob/4.7.2-stable/scene/resources/portable_compressed_texture.cpp#L194-L202)). The Basis *packer* is only registered for the editor ([basis_universal/register_types.cpp L44-L53](https://github.com/godotengine/godot/blob/4.7.2-stable/modules/basis_universal/register_types.cpp#L44-L53)). Older versions crashed in this case ([#82029](https://github.com/godotengine/godot/issues/82029), still open).

**Custom export templates (an option, not verified):** build the export templates with `cvtt_export_templates=yes` (BC7 on the CPU) or `betsy_export_templates=yes` (BC1–5 on the GPU, needs RenderingDevice and `rendering/textures/vram_compression/compress_with_gpu`). The game can then call `Image.compress()` at runtime. `Image._compress_from_channels` tries the Betsy GPU path first and falls back to the CPU function pointers ([core/io/image.cpp `_compress_from_channels`](https://github.com/godotengine/godot/blob/4.7.2-stable/core/io/image.cpp)). The trade-offs are a bigger binary, maintaining our own templates, and compression time on first load. Results could then be cached on disk.

### KTX2 / Basis (`KHR_texture_basisu`): what you actually get

The KTX loader picks a transcode target from the GPU's features ([texture_loader_ktx.cpp L281-L350](https://github.com/godotengine/godot/blob/4.7.2-stable/modules/ktx/texture_loader_ktx.cpp#L281-L350)):

| KTX2 content | Desktop target |
|---|---|
| Linear, 1 channel | BC4 |
| Linear, 2 channels | BC5 |
| Linear, RGB / RGBA | BC7 (ASTC is preferred for RGBA if supported, then BC3/ETC2) |
| **sRGB (any channel count)** | **RGBA32, uncompressed**. The source comment reads `// TODO srgb native support`. |

After transcoding to RGBA8 sRGB, the loader also calls `img->srgb_to_linear()` ([L351-L365](https://github.com/godotengine/godot/blob/4.7.2-stable/modules/ktx/texture_loader_ktx.cpp#L351-L365), [L552-L553](https://github.com/godotengine/godot/blob/4.7.2-stable/modules/ktx/texture_loader_ktx.cpp#L552-L553)). The KHR_texture_basisu spec says colour data such as base colour **MUST** use the sRGB transfer function ([Khronos spec](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_texture_basisu/README.md)). So in 4.7.2 **a spec-conformant KTX2 base colour texture ends up uncompressed in VRAM**, and its colours may come out shifted. StandardMaterial3D treats albedo as sRGB, so the data looks like it gets linearised twice and comes out too dark. *Verify this visually in a prototype.* Open PR [#114125](https://github.com/godotengine/godot/pull/114125) ("support loading sRGB textures as compressed") removes both the RGBA32 fallback and the `srgb_to_linear` call. It is unmerged (milestone `4.x`, updated 2026-10-15).

KTX2 files can carry their own mip chain, and the spec says they SHOULD. Godot keeps those mipmaps unless block padding gets in the way (same file, L511-L536). Photogrammetry assets often have just one base colour texture, so **in 4.7.2 KTX2 does little for VRAM.** It mainly makes the download smaller.

---

## 3. LODs at runtime

- The runtime glTF path does **not** generate LODs or shadow meshes. Nothing in `gltf_document.cpp` calls `generate_lods`. The runtime converter only calls `ImporterMesh.get_mesh()` ([gltf_document_extension_convert_importer_mesh.cpp L65-L69](https://github.com/godotengine/godot/blob/4.7.2-stable/modules/gltf/extensions/gltf_document_extension_convert_importer_mesh.cpp#L65-L69)). The docs describe LOD generation as an *import-time* feature: *"mesh LOD generation happens automatically for imported 3D scenes"* ([Mesh level of detail](https://docs.godotengine.org/en/stable/tutorials/3d/mesh_lod.html)).
- **It can be done by hand.** `ImporterMesh.generate_lods()` is not editor-only ([importer_mesh.cpp L570](https://github.com/godotengine/godot/blob/4.7.2-stable/scene/resources/3d/importer_mesh.cpp#L570)). The meshoptimizer simplifier it relies on is built into release templates: `config.py` has the comment *"Having this on release by default"* ([meshoptimizer/config.py](https://github.com/godotengine/godot/blob/4.7.2-stable/modules/meshoptimizer/config.py)). `ImporterMesh.get_mesh()` copies any generated LODs into the `ArrayMesh` ([importer_mesh.cpp L859-L891](https://github.com/godotengine/godot/blob/4.7.2-stable/scene/resources/3d/importer_mesh.cpp#L859-L891)). The sequence is:
  `append_from_file` → `for m in state.get_meshes(): m.mesh.generate_lods(25, 60, [])` → `generate_scene`.
  The docs warn that *"Mesh LOD generation can also take a while on complex meshes"*. Do it off the main thread, and consider caching the result (for example `ResourceSaver.save()` of the `ArrayMesh`/scene to `user://`; not verified).
- glTF has no ratified LOD extension. Godot does not support `MSFT_lod` (see §1), so shipping LODs inside the GLB is not an option.

---

## 4. Practical limits: large photogrammetry meshes, 4K/8K textures

These are **derived from the source, not measured**. Load time, peak RAM and VRAM need to be measured in a prototype on target hardware.

**File and memory**
- A GLB is limited to 4 GiB by its uint32 length header. Godot's GLB parser reads the whole BIN chunk into `GLTFState.glb_data` ([gltf_document.cpp L268-L307](https://github.com/godotengine/godot/blob/4.7.2-stable/modules/gltf/gltf_document.cpp#L268-L307)). Godot's containers use 64-bit sizes ([cowdata.h](https://github.com/godotengine/godot/blob/4.7.2-stable/core/templates/cowdata.h)).
- `append_from_buffer` needs the whole file in a `PackedByteArray`, and the parser then copies the BIN chunk again, so the raw bytes are in RAM about twice. `append_from_file` streams from disk into a single copy ([gltf_document.cpp L7313-L7362](https://github.com/godotengine/godot/blob/4.7.2-stable/modules/gltf/gltf_document.cpp#L7313-L7362)). **Download to a file and use `append_from_file`.**
- Every primitive goes through `SurfaceTool` (`create_from_triangle_arrays` → `index` → `commit_to_arrays`) ([gltf_document.cpp L1790-L1801](https://github.com/godotengine/godot/blob/4.7.2-stable/modules/gltf/gltf_document.cpp#L1790-L1801)). `SurfaceTool::Vertex` holds colour, normal, binormal, tangent, two UVs, four custom colours, the position and two vectors ([surface_tool.h L46-L66](https://github.com/godotengine/godot/blob/4.7.2-stable/scene/resources/surface_tool.h#L46-L66)). That is **about 170 bytes per vertex** of temporary RAM (an estimate from the struct layout). A 1 M-vertex Scan needs roughly 170 MB just for this step, on top of the decoded arrays.
- Indices are 32-bit, so there is no 65k-vertex limit. Godot turns on vertex compression (`ARRAY_FLAG_COMPRESS_ATTRIBUTES`) whenever the mesh has normals and no skin or morph targets ([L1786-L1788](https://github.com/godotengine/godot/blob/4.7.2-stable/modules/gltf/gltf_document.cpp#L1786-L1788)). The docs say to disable it only for meshes *"larger than a few thousand meters"* or if blocky normals/UVs appear (`IMPORT_FLAG_FORCE_DISABLE_MESH_COMPRESSION`, [GLTFDocument.xml L182-L184](https://github.com/godotengine/godot/blob/4.7.2-stable/modules/gltf/doc_classes/GLTFDocument.xml#L182-L184)). Object-sized Scans are well within that.
- Godot only generates tangents if `IMPORT_FLAG_GENERATE_TANGENT_ARRAYS` (8) is passed ([L1757](https://github.com/godotengine/godot/blob/4.7.2-stable/modules/gltf/gltf_document.cpp#L1757)). A Scan with a normal map but no `TANGENT` attribute needs this flag, and it adds MikkTSpace work at load time.

**Textures (VRAM, uncompressed as in §2)**

| Size | RGBA8 | + full mips | BC7/BC3 (if compressed) | BC1 |
|---|---|---|---|---|
| 4096² | 64 MiB | 85 MiB | 16 MiB (21 with mips) | 8 MiB |
| 8192² | 256 MiB | 341 MiB | 64 MiB (85 with mips) | 32 MiB |

- `Image` is capped at `MAX_PIXELS = 16384²` ([image.h L69-L71](https://github.com/godotengine/godot/blob/4.7.2-stable/core/io/image.h#L69-L71)). 16384 is also the 2D texture size that D3D11/12-class hardware guarantees ([D3D11 resource limits](https://learn.microsoft.com/en-us/windows/win32/direct3d11/overviews-direct3d-11-resources-limits)). 8K is safe on desktop. 16K is the hard ceiling.
- RGB8 images from JPEG usually become RGBA8 on the GPU, which is why the table uses 4 B/px.
- Decoding happens on the CPU, one image after another, inside `append_from_*`. An 8K PNG/JPEG is a large single-threaded decode, and `generate_mipmaps()` adds another full pass.

**Threads**
- `append_from_*` does the heavy CPU work: parsing, image decode and SurfaceTool. It also creates `ImageTexture`s during parsing. `generate_scene` builds the nodes and `ArrayMesh`es. The docs say building scene chunks outside the tree on a thread is fine, but warn against *"direct interaction with the GPU on other threads, such as creating new textures"* ([Thread-safe APIs](https://docs.godotengine.org/en/stable/tutorials/performance/thread_safe_apis.html)). Whether `append_from_file` can safely run on a `WorkerThreadPool` task under Forward+ needs a prototype check. Since 4.8, the global extension registry is protected by a mutex (PR [#120466](https://github.com/godotengine/godot/pull/120466)).

**Suggested v1 budget for a Game asset (a recommendation for the prototype to confirm or adjust, not a Godot limit):** at most about 1–2 M triangles, one base colour texture at ≤ 8K (4K preferred) plus an optional normal map, PNG/JPEG/WebP textures, and no Draco, meshopt or quantization. With the budget suggested above, uncompressed textures plus mipmaps cost about 85–680 MiB of VRAM per Scan.

---

## 5. `HTTPRequest` for large downloads

- **Progress:** `get_downloaded_bytes()` and `get_body_size()` work. Body size is `-1` when the server sends no `Content-Length` or uses chunked encoding ([HTTPRequest.xml L166-L171](https://github.com/godotengine/godot/blob/4.7.2-stable/doc/classes/HTTPRequest.xml#L166-L171)). S3 GETs include `Content-Length`. With gzip, the downloaded-bytes counter counts compressed bytes ([http_request.cpp L457-L466](https://github.com/godotengine/godot/blob/4.7.2-stable/scene/main/http_request.cpp#L457-L466)).
- **Streaming to disk:** set `download_file` and each chunk is written straight to the file ([L443-L449](https://github.com/godotengine/godot/blob/4.7.2-stable/scene/main/http_request.cpp#L443-L449), [L498-L508](https://github.com/godotengine/godot/blob/4.7.2-stable/scene/main/http_request.cpp#L498-L508)). Two catches:
  - The file is opened with `FileAccess.WRITE`, which truncates it, **for any response code**. An expired presigned URL (403) therefore writes S3's XML error into the file and still reports `RESULT_SUCCESS`. Always check `response_code`.
  - If the transfer does not finish (connection error, timeout, `cancel_request`, node leaving the tree), `cancel_request()` **deletes the partial file** (`DirAccess::remove_absolute`, [L192-L213](https://github.com/godotengine/godot/blob/4.7.2-stable/scene/main/http_request.cpp#L192-L213)).
- **Resume via Range: not built in.** You can send `Range: bytes=N-` as a custom header, and a `206` comes back as an ordinary success with code 206. But because of the delete-on-failure and truncating open above, `download_file` cannot continue a partial file. Resuming has to be built in the game:
  - **(a)** Fetch fixed-size ranges (for example 8–32 MiB) into memory, without `download_file`. Append each 206 body to a `.part` file opened with `FileAccess.READ_WRITE` + `seek_end()`. After a failure, restart from the size of the `.part` file. Or:
  - **(b)** Use `HTTPClient` directly.
  - S3 `GetObject` supports `Range` but *"doesn't support retrieving multiple ranges of data per GET request"* ([AWS GetObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html)). If the short-lived presigned URL expires mid-download, ask Payload for a new one and carry on from the same offset. Whether RustFS honours `Range` belongs to the object-store ticket.
- **Throughput:** with `use_threads = false` (the default), `HTTPRequest` polls once per frame from `NOTIFICATION_INTERNAL_PROCESS`. Each poll reads at most one `download_chunk_size` chunk (default 64 KiB) ([L549-L560](https://github.com/godotengine/godot/blob/4.7.2-stable/scene/main/http_request.cpp#L549-L560), [HTTPRequest.xml L245-L248](https://github.com/godotengine/godot/blob/4.7.2-stable/doc/classes/HTTPRequest.xml#L245-L248)). That works out to roughly 64 KiB × frame rate, about 3.75 MiB/s at 60 fps (derived from the source, not measured). Set `use_threads = true`, which polls in a tight loop ([L172-L188](https://github.com/godotengine/godot/blob/4.7.2-stable/scene/main/http_request.cpp#L172-L188)), and/or raise `download_chunk_size` (it can only be changed while the client is disconnected).
- **Size counters are 32-bit:** `body_len`, `downloaded`, `final_body_size` and `body_size_limit` are C++ `int`, and stay so in `master` ([http_request.h L91-L94](https://github.com/godotengine/godot/blob/4.7.2-stable/scene/main/http_request.h#L91-L94)). Responses of 2 GiB or more would overflow the completion check. Range chunks avoid the problem, and Game assets should stay well below that size anyway.
- **Timeout:** the docs recommend `timeout = 0` (disabled) for large downloads ([HTTPRequest.xml L255-L258](https://github.com/godotengine/godot/blob/4.7.2-stable/doc/classes/HTTPRequest.xml#L255-L258)).

---

## Implications for the map (#9)

1. **Validating the Game asset:** reject GLBs whose `extensionsRequired` lists anything outside Godot's runtime set. In practice that means Draco, meshopt (`EXT_`/`KHR_`) and `KHR_mesh_quantization`. Re-check the list whenever the game upgrades Godot (PR #120205).
2. **Texture format:** with stock templates, KTX2 does not cut VRAM for base colour textures, so PNG/JPEG/WebP inside the GLB is fine for v1. Choose the format for download size, and keep base colour at ≤ 8K. The game must generate mipmaps after loading.
3. **Client loading flow:** presigned URL → `HTTPRequest` with `use_threads`, `download_file` into a `user://` cache keyed by Scan id + checksum (this matches the "re-download when checksum changes" decision in #10) → check `response_code` → `append_from_file` → optionally generate mipmaps and LODs → `generate_scene` → free `GLTFState`.
4. **Escape hatch, outside current decisions:** if VRAM or load time becomes a problem, a server-side headless Godot import could produce a `.pck` per Scan. The game would load it with `ProjectSettings.load_resource_pack()` and get VRAM-compressed textures and LODs built in ([Exporting packs, patches, and mods](https://docs.godotengine.org/en/stable/tutorials/export/exporting_pcks.html)). This conflicts with "GLB throughout / uploaded GLB used as-is". The other route is custom export templates (§2).

## To verify in a prototype

- Measure load time, peak RAM and VRAM for a real 1–2 M-triangle Scan with 4K and 8K textures.
- Check whether a KTX2 sRGB base colour texture renders darker (the `srgb_to_linear` question).
- Check whether `append_from_file` is safe on a worker thread under Forward+.
- Check whether a `GLTFDocumentExtension` that only declares `KHR_mesh_quantization` makes gltfpack output load correctly.

## Sources

- Godot source at tag [`4.7.2-stable`](https://github.com/godotengine/godot/tree/4.7.2-stable) and `master` (read 2026-11-15). The files are linked inline above.
- Godot docs 4.7: [Runtime file loading and saving](https://docs.godotengine.org/en/stable/tutorials/io/runtime_file_loading_and_saving.html), [Mesh level of detail](https://docs.godotengine.org/en/stable/tutorials/3d/mesh_lod.html), [Thread-safe APIs](https://docs.godotengine.org/en/stable/tutorials/performance/thread_safe_apis.html), [Exporting packs, patches, and mods](https://docs.godotengine.org/en/stable/tutorials/export/exporting_pcks.html).
- Godot issues/PRs: [#120205](https://github.com/godotengine/godot/pull/120205) (Draco/meshopt/quantization, open), [#114125](https://github.com/godotengine/godot/pull/114125) (KTX sRGB compressed, open), [#121979](https://github.com/godotengine/godot/pull/121979) (etcpak in templates, 4.8), [#120466](https://github.com/godotengine/godot/pull/120466) (extension mutex, 4.8), [#82029](https://github.com/godotengine/godot/issues/82029) (EMBED_AS_BASISU at runtime), [godot-proposals#8576](https://github.com/godotengine/godot-proposals/issues/8576) (Draco hooks).
- Khronos: [KHR_mesh_quantization](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_mesh_quantization/README.md), [KHR_texture_basisu](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_texture_basisu/README.md).
- [gltfpack README](https://github.com/zeux/meshoptimizer/blob/master/gltf/README.md); [AWS S3 GetObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html); [D3D11 resource limits](https://learn.microsoft.com/en-us/windows/win32/direct3d11/overviews-direct3d-11-resources-limits).
- Secondary corroboration only: [Godot forum, runtime glTF mipmaps](https://forum.godotengine.org/t/not-applied-mipmap-at-gltf-runtime-loaded-model/94799).
