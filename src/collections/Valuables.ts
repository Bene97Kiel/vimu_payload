import type { CollectionConfig } from 'payload'

export const Valuables: CollectionConfig = {
  slug: 'valuables',

  timestamps: true,

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
        { label: 'Painting', value: 'Painting' },
        { label: 'Creation', value: 'Creation' },
        { label: 'Sculpture', value: 'Sculpture' },
        { label: 'Machine', value: 'Machine' },
        { label: 'Audio', value: 'Audio' },
        { label: 'Video/Movie', value: 'Video' },
        { label: 'Statue', value: 'Statue' },
        { label: 'Building', value: 'Building' },
        { label: 'Monument', value: 'Monument' },
        { label: 'Location', value: 'Location' },
        { label: 'Digital', value: 'Digital' },
        { label: 'Virtual', value: 'Virtual' },
        { label: 'Nature', value: 'Nature' },
      ],
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
