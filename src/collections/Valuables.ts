import type { CollectionConfig } from 'payload'
import { APIError } from 'payload'

import { isProviderOrAdmin } from '../access/roles'
import { getOwnProviderId } from '../access/providers'
import { deleteMediaIfUnreferenced } from '../access/media'

const toId = (value: unknown): string | number | undefined => {
  if (!value) return undefined
  return typeof value === 'object' ? (value as { id: string | number }).id : (value as string | number)
}

export const Valuables: CollectionConfig = {
  slug: 'valuables',

  timestamps: true,
  admin: {
    useAsTitle: 'title',
  },
  access: {
    // Public/client reads stay open (needed for anonymous and Flutter-app
    // browsing) — only a logged-in provider gets scoped to their own valuables.
    // Admins always see everything.
    read: ({ req: { user } }) => {
      if (!user || user.role !== 'provider') return true
      return { 'provider.user': { equals: user.id } }
    },
    create: isProviderOrAdmin,
    // A provider may only update/delete valuables under their own provider;
    // admins may manage any valuable.
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
      name: 'site',
      type: 'relationship',
      relationTo: 'sites',
      required: true,
      filterOptions: async ({ req }) => {
        if (!req.user || req.user.role === 'admin') return true
        const providerId = await getOwnProviderId(req)
        return providerId ? { provider: { equals: providerId } } : false
      },
    },
    {
      name: 'publisher',
      type: 'relationship',
      relationTo: 'users',
      required: true,
    },
    {
      name: 'provider',
      type: 'relationship',
      relationTo: 'providers',
      required: true,
    },
    {
      name: 'type',
      type: 'select',
      options: [
        { label: 'Artefact', value: 'Artefact' },
        { label: 'Sight', value: 'Sight' },
      ],
      required: true,
    },
    {
      name: 'subtype',
      type: 'select',
      options: [
        'PAINTING',
        'SCULPTURE',
        'MACHINE',
        'AUDIO',
        'MOVIE',
        'ITEM',
        'STATUE',
        'BUILDING',
        'MONUMENT',
        'LOCATION',
        'DIGITAL',
        'VIRTUAL',
        'NATURE',
        'CREATION',
      ].map((value) => ({ label: value, value })),
    },
    {
      name: 'title',
      type: 'text',
      required: true,
    },
    {
      name: 'category',
      type: 'relationship',
      relationTo: 'categories',
      required: true,
    },
    {
      name: 'data',
      type: 'group',
      fields: [
        {
          name: 'title',
          type: 'text',
          required: true,
        },
        { name: 'artist', type: 'text' },
        { name: 'year', type: 'text' },
        { name: 'description', type: 'textarea' },
      ],
    },
    {
      name: 'tags',
      type: 'array',
      fields: [
        {
          name: 'tag',
          type: 'text',
        },
      ],
    },
    {
      name: 'location',
      type: 'point',
      required: true,
    },
    {
      name: 'price',
      type: 'number',
      required: true,
    },
    {
      name: 'mediaFiles',
      type: 'array',
      fields: [
        {
          type: 'upload',
          name: 'file',
          relationTo: 'media',
        },
      ],
    },
    {
      name: 'images',
      type: 'array',
      fields: [
        {
          type: 'upload',
          name: 'image',
          relationTo: 'media',
        },
      ],
    },
  ],
  hooks: {
    beforeChange: [
      async ({ req, data, operation }) => {
        if (operation === 'create' && req.user && req.user.role !== 'admin') {
          const providerId = await getOwnProviderId(req)
          if (!providerId) {
            throw new APIError('Create your provider profile before adding a valuable.', 400)
          }

          if (data.site) {
            const site = await req.payload.findByID({
              collection: 'sites',
              id: data.site,
              depth: 0,
              overrideAccess: true,
            })
            if (!site || String(site.provider) !== String(providerId)) {
              throw new APIError('That site does not belong to your provider profile.', 400)
            }
          }

          data.provider = providerId
          data.publisher = req.user.id
        }
        return data
      },
    ],
    afterDelete: [
      async ({ req, doc }) => {
        const mediaIds = [
          ...((doc.mediaFiles ?? []) as Array<{ file?: unknown }>).map((item) => toId(item.file)),
          ...((doc.images ?? []) as Array<{ image?: unknown }>).map((item) => toId(item.image)),
        ].filter((id): id is string | number => id !== undefined)

        for (const mediaId of mediaIds) {
          await deleteMediaIfUnreferenced(req, mediaId, { collection: 'valuables', id: doc.id })
        }
      },
    ],
  },
}
