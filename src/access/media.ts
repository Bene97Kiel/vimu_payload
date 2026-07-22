import type { PayloadRequest, Where } from 'payload'

// True if this media doc is still referenced by any Site or Valuable other
// than the one currently being deleted — guards cascade-delete hooks against
// removing a file that's shared with another still-alive record.
export const isMediaReferencedElsewhere = async (
  req: PayloadRequest,
  mediaId: string | number,
  exclude: { collection: 'sites' | 'valuables'; id: string | number },
): Promise<boolean> => {
  const sitesWhere: Where = {
    and: [
      { or: [{ image: { equals: mediaId } }, { logo: { equals: mediaId } }] },
      ...(exclude.collection === 'sites' ? [{ id: { not_equals: exclude.id } }] : []),
    ],
  }
  const sitesCount = await req.payload.count({
    collection: 'sites',
    where: sitesWhere,
    overrideAccess: true,
  })
  if (sitesCount.totalDocs > 0) return true

  const valuablesWhere: Where = {
    and: [
      {
        or: [
          { 'mediaFiles.file': { equals: mediaId } },
          { 'images.image': { equals: mediaId } },
        ],
      },
      ...(exclude.collection === 'valuables' ? [{ id: { not_equals: exclude.id } }] : []),
    ],
  }
  const valuablesCount = await req.payload.count({
    collection: 'valuables',
    where: valuablesWhere,
    overrideAccess: true,
  })
  return valuablesCount.totalDocs > 0
}

// Deletes a media doc unless it's still referenced elsewhere; swallows
// not-found errors since cascades from Sites/Valuables may target the same
// media id more than once (e.g. used as both image and logo).
export const deleteMediaIfUnreferenced = async (
  req: PayloadRequest,
  mediaId: string | number,
  exclude: { collection: 'sites' | 'valuables'; id: string | number },
): Promise<void> => {
  const stillUsed = await isMediaReferencedElsewhere(req, mediaId, exclude)
  if (stillUsed) return

  try {
    await req.payload.delete({ collection: 'media', id: mediaId, overrideAccess: true })
  } catch {
    // Already gone (e.g. referenced twice on the same deleted doc) — fine.
  }
}
