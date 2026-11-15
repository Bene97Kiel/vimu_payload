import type { CollectionConfig } from 'payload'
import { APIError } from 'payload'

import { isProviderOrAdmin } from '../access/roles'
import { getOwnProviderId } from '../access/providers'
import { deleteMediaIfUnreferenced } from '../access/media'

const toId = (value: unknown): string | number | undefined => {
  if (!value) return undefined
  return typeof value === 'object' ? (value as { id: string | number }).id : (value as string | number)
}

export const Sites: CollectionConfig = {
  slug: 'sites',

  timestamps: true,
  admin: {
    // This tells Payload to use the 'name' field for labels
    // instead of the auto-generated ID
    useAsTitle: 'title',
  },
  access: {
    // Public/client reads stay open (needed for anonymous and Flutter-app
    // browsing) — only a logged-in provider gets scoped to their own sites.
    // Admins always see everything.
    read: ({ req: { user } }) => {
      if (!user || user.role !== 'provider') return true
      return { 'provider.user': { equals: user.id } }
    },
    create: isProviderOrAdmin,
    // A provider may only update/delete sites under their own provider;
    // admins may manage any site.
    update: ({ req: { user } }) => {
      if (!user) return false
      if (user.role === 'admin') return true
      return { 'provider.user': { equals: user.id } }
    },
    delete: ({ req: { user } }) => {
      if (!user) return false
      if (user.role === 'admin') return true
      return { 'provider.user': { equals: user.id } }
    },
  },
  fields: [
    {
      name: 'title',
      type: 'text',
      required: true,
    },
    {
      name: 'provider',
      type: 'relationship',
      relationTo: 'providers',
      required: true,
    },
    {
      name: 'time',
      type: 'text',
      required: true,
    },
    {
      type: 'upload',
      name: 'image',
      relationTo: 'media',
    },
    {
      type: 'upload',
      name: 'logo',
      relationTo: 'media',
    },
    {
      type: 'point',
      name: 'location',
      required: true,
    },
    {
      name: 'address',
      type: 'text',
      required: true,
    },
    {
      name: 'isAvailable',
      type: 'checkbox',
      required: true,
    },
  ],
  hooks: {
    beforeChange: [
      async ({ req, data, operation }) => {
        if (operation === 'create' && req.user && req.user.role !== 'admin') {
          const providerId = await getOwnProviderId(req)
          if (!providerId) {
            throw new APIError('Create your provider profile before adding a site.', 400)
          }
          data.provider = providerId
        }
        return data
      },
    ],
    afterDelete: [
      async ({ req, doc }) => {
        const mediaIds = [toId(doc.image), toId(doc.logo)].filter(
          (id): id is string | number => id !== undefined,
        )
        for (const mediaId of mediaIds) {
          await deleteMediaIfUnreferenced(req, mediaId, { collection: 'sites', id: doc.id })
        }
      },
    ],
  },
}
