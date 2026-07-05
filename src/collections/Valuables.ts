import type { CollectionConfig } from 'payload'

import { isProviderOrAdmin } from '../access/roles'

export const Valuables: CollectionConfig = {
  slug: 'valuables',

  timestamps: true,
  admin: {
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
      name: 'site',
      type: 'relationship',
      relationTo: 'sites',
      required: true,
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
}
