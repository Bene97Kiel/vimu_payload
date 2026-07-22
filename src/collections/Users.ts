import type { CollectionConfig } from 'payload'
import { APIError, generatePayloadCookie, headersWithCors } from 'payload'

import { isAdmin, isAdminField } from '../access/roles'
import { resetPasswordEmailHTML, verifyEmailHTML } from './Users/emails'

export const Users: CollectionConfig = {
  slug: 'users',
  admin: {
    useAsTitle: 'email',
    // Providers pass the master admin-panel gate below (they need a scoped
    // view of Sites/Valuables/Providers), but the Users collection itself
    // stays admin-only in the nav.
    hidden: ({ user }) => user?.role !== 'admin',
  },
  access: {
    // Admins and providers may reach the /admin panel at all — clients never
    // touch the CMS. (Admin-panel access must resolve to a plain boolean,
    // unlike the Where-query-capable `Access` type used elsewhere below, so
    // this can't reuse the `isAdmin` helper directly.)
    admin: ({ req: { user } }) => Boolean(user && (user.role === 'admin' || user.role === 'provider')),
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
        create: isAdminField,
        update: isAdminField,
      },
    },
  ],
  endpoints: [
    {
      path: '/register-provider',
      method: 'post',
      handler: async (req) => {
        const body = (await req.json?.()) ?? {}
        const { email, password, name, surname, nickname, lastname } = body as Record<
          string,
          string | undefined
        >

        if (!email || !password || !name || !surname) {
          throw new APIError('Missing required fields.', 400)
        }

        try {
          await req.payload.create({
            collection: 'users',
            data: { email, password, name, surname, nickname, lastname, role: 'provider' },
            overrideAccess: true,
          })
        } catch (error) {
          throw new APIError(error instanceof Error ? error.message : 'Registration failed.', 400)
        }

        return Response.json(
          { success: true },
          { headers: headersWithCors({ headers: new Headers(), req }) },
        )
      },
    },
    {
      path: '/login-provider',
      method: 'post',
      handler: async (req) => {
        const body = (await req.json?.()) ?? {}
        const { email, password } = body as Record<string, string | undefined>

        if (!email || !password) {
          throw new APIError('Missing credentials.', 400)
        }

        let result: Awaited<ReturnType<typeof req.payload.login<'users'>>>
        try {
          result = await req.payload.login({ collection: 'users', data: { email, password } })
        } catch {
          throw new APIError('Invalid email or password.', 401)
        }

        if (!result.user) {
          throw new APIError('Invalid email or password.', 401)
        }

        if (result.user.role === 'client') {
          // Valid credentials, but this is a client account — offer the
          // upgrade instead of a flat rejection. No cookie is set here; the
          // login above still records a session, but the token never reaches
          // the caller, so nothing is usable until they confirm.
          return Response.json(
            { needsUpgradeConfirmation: true },
            { headers: headersWithCors({ headers: new Headers(), req }) },
          )
        }

        if (result.user.role !== 'provider') {
          throw new APIError('This account cannot access the provider portal.', 403)
        }

        return Response.json(result, {
          headers: headersWithCors({
            headers: new Headers({
              'Set-Cookie': generatePayloadCookie({
                collectionAuthConfig: req.payload.config.collections.find(
                  (collection) => collection.slug === 'users',
                )!.auth,
                cookiePrefix: req.payload.config.cookiePrefix,
                token: result.token!,
              }),
            }),
            req,
          }),
        })
      },
    },
    {
      path: '/confirm-provider-upgrade',
      method: 'post',
      handler: async (req) => {
        const body = (await req.json?.()) ?? {}
        const { email, password } = body as Record<string, string | undefined>

        if (!email || !password) {
          throw new APIError('Missing credentials.', 400)
        }

        let firstLogin: Awaited<ReturnType<typeof req.payload.login<'users'>>>
        try {
          firstLogin = await req.payload.login({ collection: 'users', data: { email, password } })
        } catch {
          throw new APIError('Invalid email or password.', 401)
        }

        if (!firstLogin.user || firstLogin.user.role !== 'client') {
          throw new APIError('Account is not eligible for this upgrade.', 409)
        }

        await req.payload.update({
          collection: 'users',
          id: firstLogin.user.id,
          data: { role: 'provider' },
          overrideAccess: true,
        })

        // `role` is saveToJWT, so the token above still carries the stale
        // 'client' claim — re-login to get a token/cookie reflecting the
        // updated role.
        const result = await req.payload.login({ collection: 'users', data: { email, password } })

        return Response.json(result, {
          headers: headersWithCors({
            headers: new Headers({
              'Set-Cookie': generatePayloadCookie({
                collectionAuthConfig: req.payload.config.collections.find(
                  (collection) => collection.slug === 'users',
                )!.auth,
                cookiePrefix: req.payload.config.cookiePrefix,
                token: result.token!,
              }),
            }),
            req,
          }),
        })
      },
    },
  ],
}
