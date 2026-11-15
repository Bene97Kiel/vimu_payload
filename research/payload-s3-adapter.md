# Can Payload's S3 adapter handle Scans on a self-hosted store?

Research for [#12](https://github.com/Bene97Kiel/vimu_payload/issues/12) (map [#9](https://github.com/Bene97Kiel/vimu_payload/issues/9)). Researched 2026-11-15.

**What was read:** the source of `@payloadcms/storage-s3` and `@payloadcms/plugin-cloud-storage` at tag [`v3.85.1`](https://github.com/payloadcms/payload/tree/v3.85.1) (the version this repo pins), the same files at [`v3.93.0`](https://github.com/payloadcms/payload/tree/v3.93.0) (latest 3.x release, 2026-11-04), Payload core 3.85.1 in `node_modules/payload`, Next.js 16.2.6 in `node_modules/next`, the Payload and Next.js docs, Payload's GitHub security advisories, and AWS docs. Nothing was run against a real store, so store-specific behaviour (RustFS or another, see [#11](https://github.com/Bene97Kiel/vimu_payload/issues/11) / [#16](https://github.com/Bene97Kiel/vimu_payload/issues/16)) is unverified.

Terms follow `GLOSSARY.md` (Scan, Rendition, Source, Game asset, Preview, Poster, Owner).

## Short answers

| Question | Answer |
|---|---|
| Can the admin upload hundreds of MB straight from the browser? | **Yes, but as one presigned `PUT`, not multipart.** `clientUploads` makes Payload sign a `PutObject` URL (valid 600 s) and the browser PUTs the whole file to the store. There is no multipart, no resume, no chunking. The ceiling is the store's single-PUT limit (5 GB on AWS) and `upload.limits.fileSize` if set. |
| How do `signedDownloads` work, and does read access run first? | **Yes, read access runs first.** A request to `/api/<collection>/file/<filename>` runs the collection's `read` access (with `isReadingStaticFile: true`, and a DB lookup if access returns a query). Only then does the S3 handler presign a `GetObject` URL (default 7200 s) and answer `302` to it. |
| Different buckets or prefixes per collection? | **Yes.** `prefix` is per collection. Different buckets work by adding `s3Storage(...)` to `plugins` more than once (the plugin handles this on purpose). `acl` is per plugin instance, so one instance per bucket/trust level is the natural split. |
| Sign with a public hostname while Payload talks to the internal Docker hostname? | **Not with the plugin's settings.** Each plugin instance has one S3 client, used both for its own reads/writes and for presigning. The signature covers the `Host`, so you can't swap the hostname afterwards. Workable options: (A) one hostname everywhere, resolving to Caddy inside Docker too (recommended); (B) a separate presign-only client in our own endpoint (works for downloads, not for the plugin's `clientUploads`). |
| Next.js body limits for uploads that go through Payload? | **None that apply today.** Payload's REST API is an App Router route handler, which has no body cap. The 1 MB Server Actions limit doesn't apply (the admin form POSTs to REST). The 10 MB `proxyClientMaxBodySize` applies only if a `proxy.ts` (formerly `middleware.ts`) exists, and then it **silently truncates**. The real limits are Payload's: `upload.limits.fileSize` (unlimited by default), RAM buffering unless `useTempFiles: true`, and a 60 s idle timeout. |

**Upgrade first:** do not enable `storage-s3` with client uploads on 3.85.1. Three advisories affect exactly this setup and are fixed only in ≥ 3.90.0 / ≥ 3.93.0 (see [Version note](#version-note-upgrade-to--3930-before-using-storage-s3)).

---

## 1. Direct browser uploads (`clientUploads`)

### How it works (3.85.1)

1. The admin's upload field calls the plugin's client handler ([`S3ClientUploadHandler.ts`](https://github.com/payloadcms/payload/blob/v3.85.1/packages/storage-s3/src/client/S3ClientUploadHandler.ts)). It POSTs `{collectionSlug, filename, filesize, mimeType, docPrefix}` to `/api/storage-s3-generate-signed-url`.
2. The server handler ([`generateSignedURL.ts`](https://github.com/payloadcms/payload/blob/v3.85.1/packages/storage-s3/src/generateSignedURL.ts)) runs `clientUploads.access`, de-duplicates the filename against existing docs, computes the key, and returns a presigned **`PutObjectCommand`** URL with `expiresIn: 600`.
3. The browser sends **one `fetch(url, { method: 'PUT', body: file })`** to the store.
4. The admin form then submits the document to Payload with `file` set to a JSON reference instead of bytes. Payload resolves it through the adapter's `staticHandler` ([`addDataAndFileToRequest.ts`](https://github.com/payloadcms/payload/blob/v3.85.1/packages/payload/src/utilities/addDataAndFileToRequest.ts)), and the cloud-storage `afterChange` hook skips re-uploading files that carry a `clientUploadContext` ([`afterChange.ts`](https://github.com/payloadcms/payload/blob/v3.85.1/packages/plugin-cloud-storage/src/hooks/afterChange.ts)).

### Multipart and size limits

- **No multipart for client uploads.** The only client path is a single presigned `PutObject` (source above). By contrast, the *server-side* path ([`uploadFile.ts`](https://github.com/payloadcms/payload/blob/v3.85.1/packages/storage-s3/src/uploadFile.ts)) switches to `@aws-sdk/lib-storage` multipart at 50 MB (`partSize` 50 MB, `queueSize` 4). A failed 500 MB browser upload restarts from zero.
- **Store ceiling:** AWS allows up to 5 GB in a single PUT ([AWS: Uploading objects](https://docs.aws.amazon.com/AmazonS3/latest/userguide/upload-objects.html)). Hundreds of MB is well within that. The self-hosted store's own single-PUT limit must be checked in #11/#16.
- **Payload limit:** if `upload.limits.fileSize` is set in the Payload config, the sign step rejects larger files. It also signs `content-length`, so the store rejects a PUT whose size doesn't match. If it is unset (the default), the sign step has no size limit at all.
- **Expiry:** the PUT URL lives 600 s (hard-coded). AWS checks expiry when the request starts, so a long upload that started in time completes ([AWS: presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html#PresignedUrl-Expiration)). Whether the chosen store behaves the same is unverified.

### Who may get an upload URL

- In 3.85.1 the default `clientUploads.access` is `({ req }) => !!req.user`: **any logged-in user**, and in ViMu anyone can self-register. The collection's `create` access isn't consulted when the PUT URL is issued; it only runs later, when the document is saved, after the object is already in the bucket. Always pass an explicit `access`.
- 3.90.0 added `assertClientUploadAccess`, which also requires the collection's `create` or `update` access ([commit e757563](https://github.com/payloadcms/payload/commit/e7575638c773958346b6c85009474b688da95e34)). It fixes [GHSA-g6p9-6gm4-cj6m](https://github.com/payloadcms/payload/security/advisories/GHSA-g6p9-6gm4-cj6m) (client uploads could reach other collections' files, `payload` < 3.90.0) and, together with `IfNoneMatch: '*'` on the signed PUT, [GHSA-7vg8-29qx-jgj8](https://github.com/payloadcms/payload/security/advisories/GHSA-7vg8-29qx-jgj8) (client uploads could overwrite S3 objects of another collection, `storage-s3` < 3.90.0).

### What happens to the bytes after the PUT

- **3.85.1:** Payload calls the S3 `staticHandler` and does `Buffer.from(await response.arrayBuffer())` ([source](https://github.com/payloadcms/payload/blob/v3.85.1/packages/payload/src/utilities/addDataAndFileToRequest.ts)). In other words, it **downloads the whole object back from the store into RAM** to run its upload pipeline. A 500 MB Game asset costs a 500 MB heap spike in Payload, and the bytes do pass through the app server once (store → Payload, internal network).
- **≥ 3.89.0** ([#17872, commit e896688](https://github.com/payloadcms/payload/commit/e896688d1fb67bf4f0631cb3a0d7767c65a55f89)) decides per file ([`getFileContentRequirement.ts`](https://github.com/payloadcms/payload/blob/v3.93.0/packages/payload/src/uploads/getFileContentRequirement.ts), [`getFileFromClientUpload.ts`](https://github.com/payloadcms/payload/blob/v3.93.0/packages/payload/src/uploads/getFileFromClientUpload.ts)):
  - **`none`** (no bytes fetched): a non-image file in a collection **without** a `mimeTypes` allow-list. This is the GLB case if we don't set `mimeTypes`.
  - **`header`** (first 1 MB only): images, to read their dimensions.
  - **`full`**, streamed to a temp file rather than into RAM: a `mimeTypes` allow-list is set, or images with `imageSizes`/resize options.
  - In short, `mimeTypes: ['model/gltf-binary']` on a Game-asset collection pulls every upload back through Payload. Leave it off, and do GLB validation elsewhere, if "file bytes never flow through an app server" is to hold strictly.

### Other client-upload notes

- **3.85.1 doesn't check the PUT result.** The client handler ignores the PUT response status. Since 3.90.0 it throws on `!upload.ok` ([3.93.0 handler](https://github.com/payloadcms/payload/blob/v3.93.0/packages/storage-s3/src/client/S3ClientUploadHandler.ts)).
- **Store CORS:** the store must allow `PUT` from the admin origin with the `Content-Type` header, plus `If-None-Match` on ≥ 3.90 (the handler sends it). The docs say "You must allow CORS PUT method for the bucket to your website" ([Payload docs](https://payloadcms.com/docs/upload/storage-adapters#s3-usage)).
- **≥ 3.90 sends `If-None-Match: *`** (conditional write). Whether the chosen store supports it is for #11/#16 to check.

```ts
// Minimal shape (Payload ≥ 3.93). isProviderOrAdmin is src/access/roles.ts
s3Storage({
  bucket: 'scans-private',
  collections: { 'game-assets': { prefix: 'game-assets' } },
  clientUploads: { access: ({ req }) => Boolean(isProviderOrAdmin({ req })) },
  config: { /* see §4 */ },
})
```

## 2. Signed downloads (`signedDownloads`) and read access

### Flow (verified in source)

1. The client requests `GET /api/<collection>/file/<filename>`, which is the document's `url` unless `disablePayloadAccessControl` is set.
2. Payload's file endpoint ([`getFile.ts`](https://github.com/payloadcms/payload/blob/v3.85.1/packages/payload/src/uploads/endpoints/getFile.ts)) calls `checkFileAccess` **before** any handler ([`checkFileAccess.ts`](https://github.com/payloadcms/payload/blob/v3.85.1/packages/payload/src/uploads/checkFileAccess.ts)):
   - It runs the collection's `read` access with `isReadingStaticFile: true`. A `false` result throws `Forbidden`.
   - If access returns a **query**, Payload looks for a document where `filename` (or `sizes.*.filename`) matches **and** the query holds. No match means `Forbidden`.
3. Only then does it call the adapter's `staticHandler`. With `signedDownloads` on (and `shouldUseSignedURL` returning true, if given), the S3 handler presigns a `GetObjectCommand` (`expiresIn` default **7200 s**) and returns **`302`** to it ([`getFile.ts` in storage-s3](https://github.com/payloadcms/payload/blob/v3.85.1/packages/storage-s3/src/getFile.ts)). Without `signedDownloads`, the same handler **streams the object through Payload** (with Range support).

So yes: no link is issued until the collection's read access has passed. The Payload docs say the same: access control "runs _even on statically served files_" ([Payload Access Control](https://payloadcms.com/docs/upload/storage-adapters#payload-access-control)).

### Caveats

- **Access returning `true` checks no document.** If `read` returns plain `true`, Payload presigns whatever key `prefix/filename` the caller names, without checking a document exists. Ownership rules should return a query (or `false`), not `true`.
- **A link is a bearer token.** It stays valid for `expiresIn` after it is issued, even if ownership is revoked meanwhile (consistent with #10: "copies already in the game can't be pulled back"). Set `expiresIn` short, e.g. 300 s.
- **It answers with a redirect, not JSON.** #10 decided "a Payload endpoint checks ownership and returns a short-lived presigned link". `signedDownloads` does the check and redirects. A custom endpoint returning JSON gives the game a clean URL to fetch without the JWT.
  - With the redirect, a client that re-sends `Authorization: JWT …` to the store on the cross-origin hop can be rejected: S3 refuses requests that carry both a presigned query and an `Authorization` header. Browsers' Fetch drops `Authorization` on cross-origin redirects. Dart/Godot behaviour was not checked (relevant to [#21](https://github.com/Bene97Kiel/vimu_payload/issues/21)).
- **Owner checks in `read` access.** Ownership lives in `user-valuables`, so a Game-asset `read` rule would have to look up the user's completed UserValuables and return `{ id: { in: [...] } }`. That's possible, but the same rule then also governs REST reads of the asset documents.
- **Public Renditions:** set `disablePayloadAccessControl: true`. The `url` field then points straight at the store (`generateURL` = `${endpoint}/${bucket}/${key}`, always path-style ([`generateURL.ts`](https://github.com/payloadcms/payload/blob/v3.85.1/packages/storage-s3/src/generateURL.ts))), or at whatever `generateFileURL` returns. Payload's file route is then not used for reads, so no access check and no bytes through Payload ([`afterRead.ts`](https://github.com/payloadcms/payload/blob/v3.85.1/packages/plugin-cloud-storage/src/hooks/afterRead.ts), [`plugin.ts`](https://github.com/payloadcms/payload/blob/v3.85.1/packages/plugin-cloud-storage/src/plugin.ts)).

How this maps onto #10's two trust levels:

| Rendition | Plugin setting | Who gets bytes, how |
|---|---|---|
| Preview, Poster | `disablePayloadAccessControl: true`; public-read bucket policy | Anyone, direct from the store's public URL |
| Game asset | `signedDownloads: { expiresIn: 300 }` + owner-only `read`, or a custom presign endpoint (#21) | Owners, via a short-lived presigned GET |
| Source | no `signedDownloads`; `read: isAdmin` | Admins only; never handed out |

## 3. Different buckets or prefixes per collection

- **Prefix:** set per collection, e.g. `collections: { previews: { prefix: 'previews' } }` ([docs: Collection-specific options](https://payloadcms.com/docs/upload/storage-adapters#collection-specific-options)). Documents also get a hidden `prefix` field.
  - By default a document prefix *replaces* the collection prefix. `useCompositePrefixes: true` joins them ([docs: Prefix Composition](https://payloadcms.com/docs/upload/storage-adapters#prefix-composition), [`getFileKey.ts`](https://github.com/payloadcms/payload/blob/v3.85.1/packages/plugin-cloud-storage/src/utilities/getFileKey.ts)).
- **Bucket:** `bucket` is a plugin-level option, so use one `s3Storage(...)` per bucket. The plugin supports being applied more than once. `initClientUploads` suffixes the signed-URL endpoint (`-1`, `-2`, …) with the comment "to use different buckets for different collections" ([`initClientUploads.ts`](https://github.com/payloadcms/payload/blob/v3.85.1/packages/plugin-cloud-storage/src/utilities/initClientUploads.ts)). The S3 client cache key defaults to `s3:<bucket>`, so each bucket gets its own client ([`index.ts`](https://github.com/payloadcms/payload/blob/v3.85.1/packages/storage-s3/src/index.ts)).
- **`acl`** is also plugin-level. Self-hosted stores often ignore or reject object ACLs, so prefer bucket policies and leave `acl` unset (to verify in #16).
- **Object keys are filenames.** The key is `<prefix>/<sanitized filename>`. For client uploads it is fixed at signing time, before the document exists, and de-duplicated against existing docs ([`resolveSignedURLKey.ts`](https://github.com/payloadcms/payload/blob/v3.85.1/packages/plugin-cloud-storage/src/utilities/resolveSignedURLKey.ts)). #10 decided "storage keys use the Scan id, never the uploaded filename"; the built-in `clientUploads` can't do that. It needs either our own presign-upload endpoint or a rename step, a point for [#19](https://github.com/Bene97Kiel/vimu_payload/issues/19)/[#20](https://github.com/Bene97Kiel/vimu_payload/issues/20).

```ts
plugins: [
  s3Storage({ bucket: 'scans-public',  collections: { previews: { prefix: 'previews', disablePayloadAccessControl: true }, posters: { prefix: 'posters', disablePayloadAccessControl: true } }, config }),
  s3Storage({ bucket: 'scans-private', collections: { 'game-assets': { prefix: 'game-assets', signedDownloads: { expiresIn: 300 } }, sources: { prefix: 'sources' } }, config }),
]
```

## 4. Public hostname vs internal Docker hostname

### What the plugin does

- **One client per plugin instance.** Each `s3Storage` instance builds one AWS client from `config` ([`index.ts`](https://github.com/payloadcms/payload/blob/v3.85.1/packages/storage-s3/src/index.ts)). The same client does server uploads and reads, presigns client-upload PUTs ([`generateSignedURL.ts`](https://github.com/payloadcms/payload/blob/v3.85.1/packages/storage-s3/src/generateSignedURL.ts)), and presigns download GETs ([`getFile.ts`](https://github.com/payloadcms/payload/blob/v3.85.1/packages/storage-s3/src/getFile.ts)). `generateURL` also uses `config.endpoint`.
- **No separate public-endpoint option** in 3.85.1 or 3.93.0 (diffed).
- **SigV4 signs the `host` header** ([AWS SigV4 query auth](https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html)), so a URL signed for `store:9000` can't simply be rewritten to `s3.vimu.example`. It would only verify if the proxy forwarded `Host: store:9000` upstream, and the plugin offers no hook to rewrite its URLs anyway.

### Options

**A. One hostname everywhere (recommended)**

- Set `config.endpoint` to the public URL (e.g. `https://s3.vimu.example`).
- Give the Caddy container that name as a Docker network alias. Inside Docker, Payload then reaches the store via Caddy over the internal network, and browsers/phones reach the same name from outside.
- Caddy passes the incoming `Host` through unchanged by default ([Caddy reverse_proxy: Defaults](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy#defaults)), so signatures match.
- All plugin URLs then work unchanged: PUTs from `clientUploads`, `signedDownloads` redirects, and public `generateURL`s.
- Dev needs the same trick with a name that both the host browser and the Payload container can resolve (open detail).

**B. A presign-only client in our own endpoint**

Signing is offline, so a second `new S3Client({ endpoint: PUBLIC_URL, forcePathStyle: true, credentials })` can sign GET links in a custom ownership endpoint (#21) while the plugin talks to `http://store:9000`. This doesn't cover the plugin's `clientUploads`, whose PUT URL is signed with the plugin's own client. With B, direct admin uploads therefore need A anyway, or our own upload endpoint.

**C. `generateFileURL` per collection**

This fixes only the *unsigned* public URLs (the R2 example in the [docs](https://payloadcms.com/docs/upload/storage-adapters#s3-r2) does exactly this). It doesn't affect presigned URLs.

### Config notes for a non-AWS store

- `forcePathStyle: true` is needed for path-style.
- Since AWS SDK v3.729.0 the client adds CRC32 checksum headers by default. Several S3-compatible stores (MinIO, R2, B2 reported) break on them. AWS's advice for third-party stores is `requestChecksumCalculation` / `responseChecksumValidation: 'WHEN_REQUIRED'` ([aws-sdk-js-v3#6810](https://github.com/aws/aws-sdk-js-v3/issues/6810)). `storage-s3` depends on `@aws-sdk/client-s3 ^3.614.0`, so it gets the new defaults.

```ts
const config: S3ClientConfig = {
  endpoint: process.env.S3_PUBLIC_ENDPOINT, // https://s3.vimu.example — resolves to Caddy inside Docker too
  forcePathStyle: true,
  region: process.env.S3_REGION ?? 'us-east-1',
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID!, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY! },
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
}
```

```yaml
# docker-compose (sketch)
services:
  caddy:
    networks:
      default:
        aliases: [s3.vimu.example]   # Payload resolves the public name to Caddy, inside Docker
  store:
    expose: ['9000']                 # not published; only Caddy reaches it
# Caddyfile:  s3.vimu.example { reverse_proxy store:9000 }
```

## 5. Body limits for uploads that go through Payload

### Next.js 16.2.6

- **Route handlers have no body cap.** Payload's API is the App Router route handler `src/app/(payload)/api/[...slug]/route.ts`. The 1 MB `bodyParser.sizeLimit` is a Pages-Router API-route setting ([Next docs: API Routes](https://nextjs.org/docs/pages/building-your-application/routing/api-routes#custom-config)).
- **The Server Actions limit doesn't apply.** Server Actions default to 1 MB ([Next docs: serverActions.bodySizeLimit](https://nextjs.org/docs/app/api-reference/config/next-config-js/serverActions#bodysizelimit)), but Payload's document form POSTs multipart to the REST URL with `fetch` ([`Form/index.tsx`](https://github.com/payloadcms/payload/blob/v3.85.1/packages/ui/src/forms/Form/index.tsx), `requests.post(action, { body: formData })`).
- **`proxyClientMaxBodySize` (default 10 MB) only applies when a `proxy.ts` exists.** It is experimental, and the request is not rejected: Next buffers only the first 10 MB, logs a warning, and passes a **truncated** body on ([Next docs](https://nextjs.org/docs/app/api-reference/config/next-config-js/proxyClientMaxBodySize), [`body-streams.ts`](https://github.com/vercel/next.js/blob/v16.2.6/packages/next/src/server/body-streams.ts)). The repo has no `proxy.ts`/`middleware.ts` today. If one is ever added, raise the limit.

### Payload 3.85.1 (`upload` options go to Busboy; [docs](https://payloadcms.com/docs/upload/overview), [`fetchAPI-multipart`](https://github.com/payloadcms/payload/blob/v3.85.1/packages/payload/src/uploads/fetchAPI-multipart/index.ts))

- **`limits.fileSize`:** unlimited by default. With the default `abortOnLimit: false`, a file over the limit is **truncated, not rejected**. Set `abortOnLimit: true` to get a 413.
- **`useTempFiles`:** `false` by default, so the whole file is held in RAM. Set it to `true` for large files. `storage-s3` then streams from the temp file and uses multipart from 50 MB ([`uploadFile.ts`](https://github.com/payloadcms/payload/blob/v3.85.1/packages/storage-s3/src/uploadFile.ts)).
- **`uploadTimeout`:** 60 s *idle* time, reset on each chunk.

### Caddy

Caddy limits request bodies only if `request_body { max_size … }` is configured ([Caddy docs](https://caddyserver.com/docs/caddyfile/directives/request_body)).

```ts
buildConfig({
  upload: { limits: { fileSize: 2_000_000_000 }, abortOnLimit: true, useTempFiles: true },
})
```

## Version note: upgrade to ≥ 3.93.0 before using storage-s3

| Advisory | Affects | Fixed |
|---|---|---|
| [GHSA-g6p9-6gm4-cj6m](https://github.com/payloadcms/payload/security/advisories/GHSA-g6p9-6gm4-cj6m) Authorization bypass of client uploads | `payload` 3.25.0 – < 3.90.0 | 3.90.0 |
| [GHSA-7vg8-29qx-jgj8](https://github.com/payloadcms/payload/security/advisories/GHSA-7vg8-29qx-jgj8) Client uploads could overwrite S3 objects | `@payloadcms/storage-s3` < 3.90.0 | 3.90.0 |
| [GHSA-23qg-v79q-g836](https://github.com/payloadcms/payload/security/advisories/GHSA-23qg-v79q-g836) Uploaded XSL could run JS via S3 storage file URLs | `payload` < 3.93.0 | 3.93.0 |

- **Also fixed after 3.85.1:** the RAM re-download after client uploads (3.89.0, §1) and the missing PUT status check (3.90.0).
- **Node requirement:** `payload@3.93.0` requires Node `^22.23.4 || >=24.22.1` ([package.json](https://github.com/payloadcms/payload/blob/v3.93.0/packages/payload/package.json)). The `Dockerfile` uses `node:22.17.0-alpine` and `docker-compose.yml` uses `node:20-alpine`, so both must move.
- **Coming next:** the 3.x branch has since raised the minimum to 22.23.5 for the next release (commit 2026-11-12, unreleased at time of writing).
- **Payload 4** is in beta (v4.0.0-beta.9). Its upload pipeline differs (variants, upload versioning), so these findings are for 3.x only.

## Open points for other tickets

- **#11 / #16 (store):** check single-PUT size limit, presigned PUT/GET with path-style, `If-None-Match` on PUT, CORS (PUT + `Content-Type` + `If-None-Match` from the admin origin; GET for Previews in WebViews), CRC32 checksum headers, and bucket policies vs ACLs.
- **#19 (Provider upload):** the built-in `clientUploads` keys objects by filename and has no multipart/resume. Keying by Scan id or resumable uploads needs our own presign endpoint. Leave `mimeTypes` off Game-asset collections, or accept a store → Payload read per upload.
- **#21 (game download API):** use a custom endpoint returning a JSON presigned link (option B or A) rather than relying on `signedDownloads`' 302 plus JWT forwarding behaviour.
