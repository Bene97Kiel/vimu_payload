import type { CollectionConfig } from 'payload'

export const UserValuables: CollectionConfig = {
  slug: 'user-valuables',
  admin: {
    useAsTitle: 'id',
  },
  timestamps: true,
  access: {
    read: ({ req: { user } }) => {
      if (!user) return false
      if (user.role === 'admin') return true
      return { user: { equals: user.id } }
    },
    create: ({ req: { user } }) => Boolean(user),
    update: ({ req: { user } }) => Boolean(user && user.role === 'admin'),
    delete: ({ req: { user } }) => Boolean(user && user.role === 'admin'),
  },
  fields: [
    {
      name: 'user',
      type: 'relationship',
      relationTo: 'users',
      required: true,
    },
    {
      name: 'valuable',
      type: 'relationship',
      relationTo: 'valuables',
      required: true,
    },
    {
      name: 'price',
      type: 'number',
      required: true,
    },
    {
      name: 'paymentMethod',
      type: 'select',
      required: true,
      options: [
        { label: 'Stripe', value: 'Stripe' },
        { label: 'Paypal', value: 'Paypal' },
      ],
    },
    {
      name: 'paymentStatus',
      type: 'select',
      required: true,
      defaultValue: 'Pending',
      options: [
        { label: 'Pending', value: 'Pending' },
        { label: 'Completed', value: 'Completed' },
        { label: 'Failed', value: 'Failed' },
      ],
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
}
