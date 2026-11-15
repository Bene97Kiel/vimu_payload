import type { PayloadRequest } from 'payload'

// Looks up the calling user's own Providers doc (a user has at most one).
// Returns null if they haven't created a provider profile yet.
export const getOwnProviderId = async (req: PayloadRequest): Promise<string | number | null> => {
  if (!req.user) return null

  const found = await req.payload.find({
    collection: 'providers',
    where: { user: { equals: req.user.id } },
    limit: 1,
    overrideAccess: true,
  })

  return found.docs[0]?.id ?? null
}
