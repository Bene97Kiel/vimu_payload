import type { Access, FieldAccess } from 'payload'

export const isProviderOrAdmin: Access = ({ req: { user } }) =>
  Boolean(user && (user.role === 'provider' || user.role === 'admin'))

export const isAdmin: Access = ({ req: { user } }) => Boolean(user && user.role === 'admin')

// Field-level access uses a different args shape than collection-level `Access`
// (e.g. `id` may be `number | string`), so it needs its own typed helper.
export const isAdminField: FieldAccess = ({ req: { user } }) =>
  Boolean(user && user.role === 'admin')
