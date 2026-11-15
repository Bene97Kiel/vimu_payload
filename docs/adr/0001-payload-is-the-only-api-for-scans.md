---
status: accepted
---

# Payload is the only API for Scans; downloads are presigned links

Game assets may only reach their Owners, and they are large (up to 500 MB). We decided that Payload, which already holds users, JWTs and UserValuables, is the only API: it checks ownership and answers with a short-lived presigned link (15 minutes) to the S3-compatible object store, and the client downloads straight from the store. File bytes never flow through Payload or any other app server, and there is no separate download service. Decided in [#10](https://github.com/Bene97Kiel/vimu_payload/issues/10), shaped in [#12](https://github.com/Bene97Kiel/vimu_payload/issues/12) and [#21](https://github.com/Bene97Kiel/vimu_payload/issues/21).

## Considered options

- **A separate download service (e.g. FastAPI) in front of the store.** Rejected: it would duplicate Payload's auth and ownership data for no gain.
- **Streaming files through Payload.** Rejected: it ties up the Node process and its memory for every large download.
- **Payload's built-in `signedDownloads`.** Rejected for the game: it answers with a 302 redirect and finds files by filename, and nobody has checked whether Godot forwards the JWT to the store after the redirect. The game gets JSON with the link instead.

## Consequences

- A link is a bearer token: anyone holding it can use it until it expires. Revoking ownership refuses new links, but copies already downloaded can't be pulled back.
- SigV4 signs the `Host`, so the S3 hostname Payload signs with must resolve to Caddy inside Docker as well as from outside.
- Code talks plain S3, so the store can be swapped by configuration (Garage today, SeaweedFS as the fallback, see [#16](https://github.com/Bene97Kiel/vimu_payload/issues/16)).
