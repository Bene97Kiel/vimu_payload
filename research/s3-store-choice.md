# Which S3-compatible store fits one Docker server?

Research for [#11](https://github.com/Bene97Kiel/vimu_payload/issues/11), part of the map [#9](https://github.com/Bene97Kiel/vimu_payload/issues/9).
Checked on **2026-11-15** against primary sources: official docs, repositories, release notes, licence files and published security advisories. Release numbers and advisory counts change every few weeks, so treat them as a snapshot.

## Answer

**Use Garage for v1, pinned to a v2.5.x image.** Use two buckets. The public bucket (Preview, Poster, images) is served by Garage's website endpoint. The private bucket (Source, Game asset) can only be reached through presigned links that Payload signs.

- **Runner-up: SeaweedFS (`weed mini`).** It covers every need with standard S3 bucket policies and has a built-in admin UI. It also has the broadest attack surface and the most security advisories this year.
- **RustFS** fits best on paper, but it only reached 1.0 on 2026-09-16. Look at it again once 1.x has gone a few months without critical advisories.
- **MinIO** is out. The community edition was archived on 2026-04-25.

The decision hinges on these facts:

1. **On one server, every candidate keeps a single copy of each object.** Durability comes from the host (mirrored disks) and an off-site backup, whichever store you pick. The choice is about fit, safety and upkeep.
2. **Garage covers all of ViMu's S3 needs, with one difference: public read is per bucket only.** Public objects are served by a separate website endpoint (port 3902, chosen by the `Host` header). Garage has no bucket policies or ACLs. Anonymous read on the S3 endpoint is an open WIP PR aimed at Garage v3. ViMu's two trust levels already map onto two buckets.
3. **Garage has the smallest scope and the lightest footprint.** It has no IAM policy engine, no bundled console and no extra protocols. Deuxfleurs has run it in production since 2020, and its stated requirement is 1 GB of RAM. In 2026, RustFS published 42 GitHub security advisories (4 critical) and SeaweedFS 57 (19 critical). Several of them hit exactly ViMu's paths: presigned PUT and public buckets. Garage has no comparable advisory database, so the counts don't compare like for like.
4. **RustFS's presigned upload path was unsafe until two months ago.** Before 1.0.0, anyone holding a presigned PUT URL could read any object the signing key could reach ([GHSA-xm99-m3gq-83g8](https://github.com/rustfs/rustfs/security/advisories/GHSA-xm99-m3gq-83g8)). RustFS's own docs describe single-disk mode as being for "development, testing, and small non-critical workloads".
5. **Garage v2.5.0, the current release, rejects presigned PUT URLs from the AWS SDK v3 with default settings** (400 `InvalidDigest`). The fix ([PR #1599](https://git.deuxfleurs.fr/Deuxfleurs/garage/pulls/1599)) was merged on 2026-11-07 but hasn't been released yet. Until then, set `requestChecksumCalculation: 'WHEN_REQUIRED'` in the S3 client config passed to `@payloadcms/storage-s3`.
6. **Switching later is cheap.** Payload talks plain S3, so moving to another store means copying the objects (for example with rclone) and changing config: endpoint, bucket names and the base URL for public files.

## What ViMu needs

From the [#10 resolution](https://github.com/Bene97Kiel/vimu_payload/issues/10) and `architecture/ARCHITECTURE.md`:

- **Public read** for Preview, Poster and images.
- **Private Source and Game asset**, reachable only through presigned GET links signed by Payload's S3 adapter after an ownership check.
- **Large uploads straight from the browser** (hundreds of MB) through presigned PUT or multipart.
- **CORS**:
  - The admin UI uploads from the browser.
  - The app's 3D viewer (`model_viewer_plus`) runs in a WebView served from a random localhost port, so its GLB fetches are cross-origin (ARCHITECTURE.md §2.4).
- **Lifecycle rules**: at least cleaning up abandoned multipart uploads.
- **Hosting**: one Linux server running docker compose, next to Payload, MongoDB and Caddy. The store gets its own public hostname.

How Payload's adapter uploads today: with `clientUploads`, [`@payloadcms/storage-s3`](https://github.com/payloadcms/payload/blob/main/packages/storage-s3/src/generateUploadInstructions.ts) returns **one presigned `PutObject` URL**.

- The URL expires after 600 s.
- It signs `content-type`, plus `content-length` when an upload size limit is set.
- The browser must send `If-None-Match: *` with the upload.
- It does not use multipart.

A single PUT can carry [up to 5 GB](https://docs.aws.amazon.com/AmazonS3/latest/userguide/upload-objects.html) on AWS, so hundreds of MB fit. Multipart from the browser would need custom code. All three stores support it.

## Comparison

| | Garage | SeaweedFS | RustFS |
|---|---|---|---|
| **Licence** | AGPL-3.0 ([LICENSE](https://git.deuxfleurs.fr/Deuxfleurs/garage/src/branch/main-v2/LICENSE)) | Apache-2.0 ([README](https://github.com/seaweedfs/seaweedfs#license)); paid Enterprise edition exists | Apache-2.0 ([README](https://github.com/rustfs/rustfs)) |
| **Latest release** | [v2.5.0](https://git.deuxfleurs.fr/Deuxfleurs/garage/releases), 2026-10-24. v1.x still gets patches (v1.3.1, 2026-01-24) | [4.53](https://github.com/seaweedfs/seaweedfs/releases), 2026-11-08. 8 releases between 2026-09-08 and 2026-11-08 | [1.0.5](https://github.com/rustfs/rustfs/releases), 2026-11-10. 1.0.0 (GA) was 2026-09-16 |
| **Track record** | In production at Deuxfleurs since the first release in 2020 | Repo created 2014 | Repo created Nov 2023 |
| **Single-node mode** | `garage server --single-node` (v2.3.0+), `replication_factor = 1` | `weed mini`: master, volume, filer, S3 and admin in one process | SNSD (single node, single disk) |
| **Vendor's single-node durability statement** | rf=1 means "no redundancy … Do not use this for anything else than test deployments" | `weed mini` "is fine for single-node production, such as an S3 gateway that issues presigned URLs" | "A single drive offers no redundancy"; SNSD is for "development, testing, and small non-critical workloads" |
| **Presigned GET / PUT** | Yes / yes (see the checksum caveat in [Garage](#garage)) | Yes / yes | Yes / yes |
| **Multipart upload** | Yes | Yes | Yes |
| **Anonymous read** | Whole bucket only, through the website endpoint. No bucket policies or ACLs | Bucket policy with `Principal: "*"`, `public-read` ACL, or identity actions scoped to a prefix | Bucket policy. ACL authorization is intentionally unsupported |
| **CORS** | `PutBucketCors`, applied on both the S3 and website endpoints | `PutBucketCors`, plus a global `-s3.allowedOrigins` | `PutBucketCors`, plus a global `RUSTFS_CORS_ALLOWED_ORIGINS` |
| **Lifecycle** | Only `Expiration` and `AbortIncompleteMultipartUpload` | Expiration, NoncurrentVersionExpiration and AbortIncompleteMultipartUpload; no transitions | Full ILM, including transitions to a remote S3 tier |
| **`If-None-Match` on PUT** | Ignored: the PUT overwrites ([#1326](https://git.deuxfleurs.fr/Deuxfleurs/garage/issues/1326)) | Honoured | Honoured |
| **Versioning / Object Lock** | No / no | Yes / yes | Yes / yes |
| **Admin UI** | Official Web Admin still in testing (standalone v0.2.2, 2026-11-13, later bundled into Garage). Otherwise CLI + admin API | Built in (port 12535). No auth unless a password is set, and it binds to loopback without one | Built-in Console (port 9001) |
| **Backup tooling** | Automatic metadata snapshots. No built-in data backup, so copy the data through the S3 API | `weed filer.backup`: continuous or incremental copy to S3, GCS, Azure, B2 or a local disk | Bucket replication and site replication to another S3 target |
| **Stated resources** | 1 GB RAM, 16 GB disk, any x86_64 CPU from the last 10 years | No minimum stated. Each volume server keeps a 16-byte in-memory index entry per blob | 2 GB RAM minimum for a test setup. "Production" minimum is 128 GB, which is sized for clusters |
| **GitHub security advisories published in 2026** | No advisory database to compare. Release notes list a reflected-XSS fix (v2.4.0) and a lifecycle permission fix (v2.5.0) | 57 (19 critical), all since June 2026 | 42 (4 critical) |

## Garage

**What it is.** A small-scale, geo-distributed S3 store by Deuxfleurs, released under AGPLv3 ([README](https://git.deuxfleurs.fr/Deuxfleurs/garage)).

- Its [goals page](https://garagehq.deuxfleurs.fr/documentation/design/goals/) lists *feature extensiveness* and *extreme performance* as non-goals.
- Its [homepage](https://garagehq.deuxfleurs.fr/) asks for 1 GB RAM, at least 16 GB of disk, and any x86_64 CPU from the last 10 years (or ARMv7/ARMv8).
- The v2 line is stable. v2.3.0 (2026-04-16) added `--single-node`, `--default-access-key` and `--default-bucket`, so one container comes up with a key and a bucket already created ([release notes](https://git.deuxfleurs.fr/Deuxfleurs/garage/releases)).
- v2.5.0 (2026-10-24) restricts the lifecycle endpoints to keys with owner permission and adds a `public_endpoint` setting.

**Durability on one node.** `replication_factor = 1` keeps a single copy. The [configuration reference](https://garagehq.deuxfleurs.fr/documentation/reference-manual/configuration/) says not to use it outside test deployments, because one copy means no protection against losing the disk. That's true of every single-node store; the other projects simply don't warn as bluntly.

- Garage checksums data blocks, but not metadata. Put metadata on a robust filesystem ([real-world cookbook](https://garagehq.deuxfleurs.fr/documentation/cookbook/real-world/)).
- LMDB "is prone to database corruption after an unclean shutdown". SQLite avoids this at some speed cost. On a single node, use `db_engine = "sqlite"` and set `metadata_auto_snapshot_interval`.
- On an unreplicated cluster, restoring a snapshot loses every change made after it ([recovering](https://garagehq.deuxfleurs.fr/documentation/operations/recovering/)).

**S3 features for ViMu** ([S3 compatibility](https://garagehq.deuxfleurs.fr/documentation/reference-manual/s3-compatibility/)):

- **Supported**: presigned URLs, the full multipart set, and `PutBucketCors`.
- **Lifecycle (partial)**: only `Expiration` and `AbortIncompleteMultipartUpload`. That covers cleaning up abandoned uploads.
- **Not supported**: bucket policies, ACLs and versioning.
- **Public read** uses the website endpoint ([exposing websites](https://garagehq.deuxfleurs.fr/documentation/cookbook/exposing-websites/)):
  - `garage bucket website --allow <bucket>` makes the whole bucket public on port 3902.
  - The bucket is picked by the `Host` header: either `<bucket>.<root_domain>` or a global alias equal to the hostname.
  - The website handler applies the bucket's CORS rules ([`web_server.rs`](https://git.deuxfleurs.fr/Deuxfleurs/garage/src/branch/main-v2/src/web/web_server.rs)).
  - For ViMu, this means a second public hostname (or a Caddy rule that rewrites `Host`) next to the S3 API hostname.
- **Not available yet**:
  - Anonymous read on the S3 endpoint: [#263](https://git.deuxfleurs.fr/Deuxfleurs/garage/issues/263), [WIP PR #1306](https://git.deuxfleurs.fr/Deuxfleurs/garage/pulls/1306), which targets `next-v3`.
  - Permissions scoped to a prefix: [#1212](https://git.deuxfleurs.fr/Deuxfleurs/garage/issues/1212), open.
  - Conditional writes: [#1052](https://git.deuxfleurs.fr/Deuxfleurs/garage/issues/1052), open. The maintainers say they conflict with Garage's weak-consistency model.

**Known bug that affects Payload.** Recent `@aws-sdk/client-s3` versions add `x-amz-checksum-crc32=AAAAAA==` (the CRC of an empty body) to presigned PUT URLs. AWS ignores it; Garage v2.5.0 enforces it and returns 400 `InvalidDigest` ([#1236](https://git.deuxfleurs.fr/Deuxfleurs/garage/issues/1236)).

- The fix is [PR #1599](https://git.deuxfleurs.fr/Deuxfleurs/garage/pulls/1599), merged on 2026-11-07. It isn't in a release yet.
- Workaround: set `requestChecksumCalculation: 'WHEN_REQUIRED'` on the S3 client.

**Admin UI.** The official [Garage Web Admin](https://git.deuxfleurs.fr/Deuxfleurs/garage-webadmin) covers nodes and cluster layout, buckets (aliases, quotas, website access, CORS rules), access keys and admin tokens.

- Its README says it is "in testing phase" and will be bundled into the Garage binary.
- For now it ships as standalone builds (v0.2.2, 2026-11-13).
- Until then, admin goes through the `garage` CLI and the [admin API](https://garagehq.deuxfleurs.fr/documentation/quick-start/) on port 3903.

**Backup.**

- Metadata: automatic snapshots (`metadata_auto_snapshot_interval`).
- Data: there is no built-in backup or replication to an outside target, so copy the objects through the S3 API (for example `rclone sync` with provider `Other` ([rclone S3](https://rclone.org/s3/))).

**Docker.** The image is `dxflrs/garage:v2.5.0` ([quick start](https://garagehq.deuxfleurs.fr/documentation/quick-start/)).

- Ports: 3900 (S3), 3901 (RPC), 3902 (website), 3903 (admin).
- The cookbook uses `network_mode: host`, which is needed for nodes to reach each other in multi-node setups. One node on a compose network only needs 3900 and 3902 reachable from Caddy.

**Licence note.** AGPLv3's network clause applies to *modified* versions offered over a network. Running the unmodified image as a separate service that Payload talks to over HTTP is the common case. This is not legal advice.

## SeaweedFS

**What it is.** A distributed blob store from 2014 with a filer and an S3 gateway, licensed Apache-2.0 ([README](https://github.com/seaweedfs/seaweedfs)).

- Its scope keeps growing: POSIX/FUSE, WebDAV, Iceberg/S3 Tables, vector buckets.
- A paid Enterprise edition adds "data recovery, self-healing storage" and more.
- It ships often: 4.46 through 4.53 (8 releases) came out between 2026-09-08 and 2026-11-08.

**Single node.** [`weed mini`](https://github.com/seaweedfs/seaweedfs/wiki/Quick-Start-with-weed-mini) runs master, volume server, filer, S3 gateway, WebDAV, Admin UI, maintenance worker and Iceberg catalog in one process.

- The README calls it "fine for single-node production, such as an S3 gateway that issues presigned URLs". That is exactly ViMu's case.
- Caveats from the same page:
  - Without credentials, S3 runs in "Allow All" mode.
  - The Admin UI has no auth by default.
  - Defaults "may evolve between releases", so pin a version.
- Replication `000` keeps one copy. Extra copies need more volume servers. Checksums detect corrupted volumes ([replication](https://github.com/seaweedfs/seaweedfs/wiki/Replication)).

**S3 features for ViMu** ([Amazon S3 API](https://github.com/seaweedfs/seaweedfs/wiki/Amazon-S3-API)):

- Presigned URLs, the full multipart set, conditional headers, POST policy uploads, versioning and Object Lock.
- **Public read**, three ways:
  - A bucket policy with `"Principal": "*"` on `arn:aws:s3:::bucket/*` ([bucket policies](https://github.com/seaweedfs/seaweedfs/wiki/S3-Bucket-Policies)).
  - `s3.bucket.access -user anonymous -access Read,List`.
  - A `public-read` ACL. Identity actions can be scoped to a prefix, for example `Read:mybucket/uploads/*` ([credentials](https://github.com/seaweedfs/seaweedfs/wiki/S3-Credentials)).
- **CORS**: per-bucket `PutBucketCors`, which takes priority over the global `-s3.allowedOrigins` ([CORS](https://github.com/seaweedfs/seaweedfs/wiki/S3-CORS)).
- **Lifecycle** ([S3 lifecycle](https://github.com/seaweedfs/seaweedfs/wiki/S3-Lifecycle)):
  - Supported: Expiration (days or date), NoncurrentVersionExpiration and AbortIncompleteMultipartUpload, with prefix, tag and size filters.
  - Transitions return `NotImplemented`.
  - A daily worker runs the rules, so "Expiration is not event-time accurate".

**Admin UI.** Built in ([Admin UI](https://github.com/seaweedfs/seaweedfs/wiki/Admin-UI), port 12535).

- It manages buckets, quotas, lifecycle rules, S3 users, keys and bucket policies, plus cluster status and maintenance.
- Without a password it binds to loopback.
- OIDC sign-in is Enterprise-only.

**Backup.** [`weed filer.backup`](https://github.com/seaweedfs/seaweedfs/wiki/Async-Backup) follows the filer's change log and copies continuously to S3, GCS, Azure, B2 or a local disk.

- Mirror mode keeps the same directory structure.
- Incremental mode writes dated folders and ignores deletes.

**Security record.** 57 advisories were published since 2026-06-10, 19 of them critical ([advisories](https://github.com/seaweedfs/seaweedfs/security/advisories)). Many involve unauthenticated internal gRPC ports, STS or S3 Tables. Some hit ViMu's paths directly; all three are fixed in current releases:

- Presigned URLs could be redirected to another bucket via `X-Forwarded-Host`, ≤ 4.46 ([GHSA-f9c3-24w9-cr8p](https://github.com/seaweedfs/seaweedfs/security/advisories/GHSA-f9c3-24w9-cr8p)).
- Stored XSS on public buckets via response-header overrides, ≤ 4.47 ([GHSA-54j8-2gxc-wr9h](https://github.com/seaweedfs/seaweedfs/security/advisories/GHSA-54j8-2gxc-wr9h)).
- The S3 gateway's gRPC port exposed IAM admin without auth, ≤ 4.47 ([GHSA-g96f-g546-47xf](https://github.com/seaweedfs/seaweedfs/security/advisories/GHSA-g96f-g546-47xf)).

**Docker.** The image is `chrislusf/seaweedfs`, which runs `weed mini -dir=/data`. S3 listens on port 8333.

## RustFS

**What it is.** A MinIO-style object store written in Rust, licensed Apache-2.0 ([README](https://github.com/rustfs/rustfs)).

- 1.0.0 shipped on 2026-09-16 after a run of release candidates. 1.0.5 followed on 2026-11-10 ([releases](https://github.com/rustfs/rustfs/releases)).
- The README marks the console, ILM, bucket and site replication, versioning, Object Lock and IAM/policies as "Available".

**Single node.** [SNSD](https://docs.rustfs.com/installation/linux/single-node-single-disk) says:

- "A single drive offers no redundancy. If the drive fails, data is lost."
- It suits "development, testing, and small non-critical workloads".
- "For production use, keep backups or choose SNMD or MNMD."

An SNSD deployment cannot be expanded later; you have to migrate through S3. The [prerequisites page](https://docs.rustfs.com/installation/linux/prerequisites-and-service) says at least 2 GB of memory for a test environment and 128 GB for production, and strongly recommends XFS.

**S3 features for ViMu** ([S3 compatibility matrix](https://github.com/rustfs/rustfs/blob/main/docs/architecture/s3-compatibility-matrix.md)):

- **Supported**, each backed by Ceph s3-tests in CI:
  - presigned GET and PUT
  - multipart create, upload, complete and abort
  - bucket policy put, get and delete
  - public access block
  - CORS
  - conditional writes
- **Not supported**: ACL authorization, by design.
- **Public read** uses a bucket policy with a wildcard principal. `BlockPublicPolicy` must be off first ([bucket policy docs](https://docs.rustfs.com/administration/data/bucket/policy)).
- **CORS**: per-bucket `PutBucketCors` exists ([source](https://github.com/rustfs/rustfs/blob/main/rustfs/src/app/bucket_usecase/cors.rs)). There is also a global `RUSTFS_CORS_ALLOWED_ORIGINS`; when it is unset, the S3 endpoint adds no generic CORS headers ([CORS docs](https://docs.rustfs.com/administration/cors)).
- **Lifecycle**: rules include `AbortIncompleteMultipartUpload`, Expiration, noncurrent-version rules and transitions ([source](https://github.com/rustfs/rustfs/blob/main/rustfs/src/storage/s3_compat/lifecycle.rs)).

**Admin UI.** A built-in Console runs on port 9001 ([Docker install](https://docs.rustfs.com/installation/docker/)). It had a critical stored XSS that led to admin takeover (CVE-2026-27822), and the first fix was incomplete (CVE-2026-62378). Keep it off the internet.

**Backup.** Bucket replication and site replication to another S3 target, or a plain S3 copy.

**Security record.** 42 advisories in 2026, 4 of them critical ([advisories](https://github.com/rustfs/rustfs/security/advisories)). Two hit ViMu's upload path directly; both were fixed in 1.0.0:

- A presigned PUT URL could read any bucket ([GHSA-xm99-m3gq-83g8](https://github.com/rustfs/rustfs/security/advisories/GHSA-xm99-m3gq-83g8)).
- Unsigned `x-amz-*` headers were honoured on presigned uploads ([GHSA-g8w9-qw9q-fghr](https://github.com/rustfs/rustfs/security/advisories/GHSA-g8w9-qw9q-fghr)).

Even 1.0.0 itself had high-severity advisories, among them an Object Lock bypass.

**Docker.** The image is `rustfs/rustfs` and runs as UID 10001. Ports: 9000 (S3), 9001 (console). Configure it with `RUSTFS_ACCESS_KEY` and `RUSTFS_SECRET_KEY`, and never keep the default `rustfsadmin`.

## MinIO: current status

- **The community edition is dead.** The [repository](https://github.com/minio/minio) was archived on **2026-04-25**. The README says "THIS REPOSITORY IS NO LONGER MAINTAINED" and that the community edition "is now distributed as source code only".
- **Last community release**: [RELEASE.2025-10-15T17-29-55Z](https://github.com/minio/minio/releases/tag/RELEASE.2025-10-15T17-29-55Z).
- **The console was gutted earlier.** In [RELEASE.2025-05-24](https://github.com/minio/minio/releases/tag/RELEASE.2025-05-24T17-08-30Z), the embedded console was deprecated and moved to `object-browser`, and LDAP/OIDC logins became AIStor-only.
- **MinIO now sells AIStor**, including a free standalone "AIStor Free" edition under a proprietary licence. It was not evaluated here.
- **A community fork exists**: [pgsty/minio](https://github.com/pgsty/minio) (AGPL-3.0, last release 2026-11-12). Not evaluated in depth.
- **Not recommended.** Starting a new deployment on an archived upstream gets no security fixes.

## Setup notes that apply to any store

These are for the implementation spec.

- **Single copy.**
  - Put the store's volume on mirrored disks (RAID1 or a ZFS mirror) and copy the buckets off-site through the S3 API.
  - Backups are already listed in the map's "Not yet specified".
- **Sign presigned URLs for the public hostname.** SigV4 presigned URLs sign the `Host` header (`X-Amz-SignedHeaders=host`, see the URL in [Garage #1236](https://git.deuxfleurs.fr/Deuxfleurs/garage/issues/1236)). Payload's S3 client must therefore sign with the public endpoint, not the compose-internal service name.
- **Leave Payload's `acl` option unset.** Public access is a bucket setting: website access in Garage, a bucket policy elsewhere. Garage and RustFS don't implement ACLs.
- **Overwriting a key through Payload's client upload.** The upload sends `If-None-Match: *`. Stores that honour it (SeaweedFS, RustFS) refuse to overwrite an existing key; Garage ignores the header. "Replacing a Scan overwrites" therefore needs a fresh key or a server-side step.
- **Keep admin and internal ports off the internet.** That means Garage 3901/3903, SeaweedFS 12535 and its gRPC ports, and RustFS 9001. Several 2026 advisories needed only network access to those ports. Pin image versions.

## Open checks for the prototype

- An end-to-end presigned PUT from Payload against Garage with `requestChecksumCalculation: 'WHEN_REQUIRED'`, and without it once a release containing PR #1599 ships.
- Garage's website endpoint behind Caddy:
  - which hostname scheme to use
  - CORS on GLB fetches from `model_viewer_plus`
  - Range requests and `Cache-Control`
- Idle RAM and CPU were **not measured** here. The figures above are the vendors' own.
