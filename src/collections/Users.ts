import type { CollectionConfig } from 'payload'

import { isAdmin, isAdminField } from '../access/roles'
import { resetPasswordEmailHTML, verifyEmailHTML } from './Users/emails'

export const Users: CollectionConfig = {
  slug: 'users',
  admin: {
    useAsTitle: 'email',
  },
  access: {
    // Public self-registration — Payload's real default access rule is
    // `Boolean(user)` (must already be authenticated), which silently blocks
    // registration entirely if left unset.
    create: () => true,
    // A user may read/update their own record; admins may read/update anyone's.
    read: ({ req: { user } }) => {
      if (!user) return false
      if (user.role === 'admin') return true
      return { id: { equals: user.id } }
    },
    update: ({ req: { user } }) => {
      if (!user) return false
      if (user.role === 'admin') return true
      return { id: { equals: user.id } }
    },
    delete: isAdmin,
  },
  auth: {
    verify: {
      generateEmailHTML: verifyEmailHTML,
      generateEmailSubject: () => 'Verify your ViMu account',
    },
    forgotPassword: {
      generateEmailHTML: resetPasswordEmailHTML,
      generateEmailSubject: () => 'Reset your ViMu password',
    },
  },
  fields: [
    {
      name: 'surname',
      type: 'text',
      required: true,
    },
    {
      name: 'name',
      type: 'text',
      required: true,
    },
    {
      name: 'nickname',
      type: 'text',
    },
    {
      name: 'lastname',
      type: 'text',
    },
    {
      name: 'role',
      type: 'select',
      required: true,
      defaultValue: 'client',
      saveToJWT: true,
      options: [
        { label: 'Client', value: 'client' },
        { label: 'Provider', value: 'provider' },
        { label: 'Admin', value: 'admin' },
      ],
      access: {
        update: isAdminField,
      },
    },
  ],
}
