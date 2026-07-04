import type { CollectionConfig } from 'payload'

import { isProviderOrAdmin } from '../access/roles'

export const Provider: CollectionConfig = {
  slug: 'providers',
  admin: {
    // This tells Payload to use the 'name' field for labels
    // instead of the auto-generated ID
    useAsTitle: 'name',
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
      name: 'user',
      type: 'relationship',
      relationTo: 'users',
      required: true,
    },
  ],
}
