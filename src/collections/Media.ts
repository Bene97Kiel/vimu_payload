import type { CollectionConfig } from 'payload'

import { isProviderOrAdmin } from '../access/roles'

export const Media: CollectionConfig = {
  slug: 'media',
  access: {
    read: () => true,
    // Without explicit rules, Payload falls back to `Boolean(user)`, which would
    // let any logged-in client upload, overwrite or delete files.
    create: isProviderOrAdmin,
    update: isProviderOrAdmin,
    delete: isProviderOrAdmin,
  },
  fields: [
    {
      name: 'alt',
      type: 'text',
      required: true,
    },
    {
      name: 'user',
      type: 'relationship',
      relationTo: 'users',
      access: {
        update: ({ req }) => req.user?.role === 'admin',
      },
    },
  ],
  hooks: {
    beforeChange: [
      ({ req, data, operation }) => {
        if (operation === 'create' && req.user) {
          data.user = req.user.id
        }
        return data
      },
    ],
  },
  upload: true,
}
