import type { CollectionConfig } from 'payload'

import { isAdmin, isAdminField } from '../access/roles'

export const Media: CollectionConfig = {
  slug: 'media',
  access: {
    // Public/client reads stay open (images are shown in the Flutter app and
    // public pages) — only a logged-in provider gets scoped to their own uploads.
    read: ({ req: { user } }) => {
      if (!user || user.role !== 'provider') return true
      return { user: { equals: user.id } }
    },
    // create/update were previously unset, which Payload defaults to fully
    // open (including unauthenticated requests) — require login instead.
    create: ({ req: { user } }) => Boolean(user),
    update: ({ req: { user } }) => {
      if (!user) return false
      if (user.role === 'admin') return true
      return { user: { equals: user.id } }
    },
    // Providers may never delete media directly — a file can only be removed
    // as a side effect of deleting the Site/Valuable it's attached to (see
    // the afterDelete hooks on those collections). Admins can still delete
    // directly.
    delete: isAdmin,
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
        update: isAdminField,
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
