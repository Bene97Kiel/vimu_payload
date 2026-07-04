import type { CollectionConfig } from 'payload'

import { isProviderOrAdmin } from '../access/roles'

export const Sites: CollectionConfig = {
  slug: 'sites',

  timestamps: true,
  admin: {
    // This tells Payload to use the 'name' field for labels
    // instead of the auto-generated ID
    useAsTitle: 'title',
  },
  access: {
    read: () => true,
    create: isProviderOrAdmin,
    update: isProviderOrAdmin,
    delete: isProviderOrAdmin,
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
}
