---
status: accepted
---

# Scans have their own collection and upload endpoints, not Payload upload collections

Payload's upload collections, with `@payloadcms/storage-s3` client uploads, key every object by its filename, finish the upload when the document is saved, and offer no hook between upload and use. Scans need more: keys by Scan id with a fresh revision id per write, a staging area so nothing unvalidated is ever public, validation and Preview/Poster generation in a worker, and a single switch at the end so a failed replacement never takes the live version down. We therefore made `scans` a plain collection with one field group per Rendition, plus our own endpoints that sign uploads into `incoming/` and commit them to a Payload Jobs workflow. The storage plugin stays only for ordinary images (`media`). Decided in [#19](https://github.com/Bene97Kiel/vimu_payload/issues/19), building on [#12](https://github.com/Bene97Kiel/vimu_payload/issues/12) and [#20](https://github.com/Bene97Kiel/vimu_payload/issues/20).

## Consequences

- Scan files don't show up as Payload uploads in `/admin`. Providers use a custom Scan panel on the Valuable's page.
- We own the code Payload would otherwise provide: signing, size checks, upload access, and deleting a Scan's files when its Valuable is deleted.
- Don't "simplify" Scans back into an upload collection without solving keying, staging and the atomic switch some other way.
