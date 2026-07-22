import type { CollectionConfig } from 'payload'
import { APIError } from 'payload'

import { isProviderOrAdmin } from '../access/roles'

export const Provider: CollectionConfig = {
  slug: 'providers',
  admin: {
    // This tells Payload to use the 'name' field for labels
    // instead of the auto-generated ID
    useAsTitle: 'name',
  },
  access: {
    // Public/client reads stay open (needed for anonymous and Flutter-app
    // browsing) — only a logged-in provider gets scoped to their own record.
    // Admins always see everything.
    read: ({ req: { user } }) => {
      if (!user || user.role !== 'provider') return true
      return { user: { equals: user.id } }
    },
    create: isProviderOrAdmin,
    // A provider may only update/delete their own record; admins may manage any.
    update: ({ req: { user } }) => {
      if (!user) return false
      if (user.role === 'admin') return true
      return { user: { equals: user.id } }
    },
    delete: ({ req: { user } }) => {
      if (!user) return false
      if (user.role === 'admin') return true
      return { user: { equals: user.id } }
    },
  },

  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
    },
    {
      name: 'user',
      type: 'relationship',
      relationTo: 'users',
      required: true,
    },
  ],
  hooks: {
    beforeChange: [
      async ({ req, data, operation }) => {
        if (operation === 'create' && req.user && req.user.role !== 'admin') {
          const existing = await req.payload.find({
            collection: 'providers',
            where: { user: { equals: req.user.id } },
            limit: 1,
            overrideAccess: true,
          })
          if (existing.docs.length > 0) {
            throw new APIError('You already have a provider profile.', 400)
          }
          data.user = req.user.id
        }
        return data
      },
    ],
  },
}
