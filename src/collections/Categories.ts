import type { CollectionConfig } from 'payload'

import { isProviderOrAdmin } from '../access/roles'

export const Categories: CollectionConfig = {
  slug: 'categories',
  admin: {
    useAsTitle: 'name',
    // Categories are a shared, admin-managed taxonomy — not provider-owned.
    hidden: ({ user }) => user?.role !== 'admin',
  },
  access: {
    read: () => true,
    create: isProviderOrAdmin,
    update: isProviderOrAdmin,
    delete: isProviderOrAdmin,
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
    },
    {
      name: 'icon',
      type: 'upload',
      relationTo: 'media',
      required: true,
    },
  ],
}
