import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cleanupRoleUsers, seedRoleUsers } from '../helpers/seedRoleUsers'

let payload: Payload
let users: Awaited<ReturnType<typeof seedRoleUsers>>

describe('Role-based access control', () => {
  beforeAll(async () => {
    const payloadConfig = await config
    payload = await getPayload({ config: payloadConfig })
    users = await seedRoleUsers()
  })

  afterAll(async () => {
    await cleanupRoleUsers()
  })

  it('allows anonymous reads of Categories/Providers/Sites/Valuables', async () => {
    await expect(payload.find({ collection: 'categories', overrideAccess: false })).resolves.toBeDefined()
    await expect(payload.find({ collection: 'providers', overrideAccess: false })).resolves.toBeDefined()
    await expect(payload.find({ collection: 'sites', overrideAccess: false })).resolves.toBeDefined()
    await expect(payload.find({ collection: 'valuables', overrideAccess: false })).resolves.toBeDefined()
  })

  it.each(['categories', 'providers', 'sites', 'valuables'] as const)(
    'forbids a client from creating a %s document',
    async (collection) => {
      // `data` is deliberately empty/invalid — access control must reject the
      // request before field validation ever runs, so the exact shape doesn't matter.
      await expect(
        payload.create({
          collection,
          data: {},
          user: users.client,
          overrideAccess: false,
        } as Parameters<typeof payload.create>[0]),
      ).rejects.toThrow()
    },
  )

  it('allows a provider to create a Provider document', async () => {
    const provider = await payload.create({
      collection: 'providers',
      data: { name: 'Provider created by provider role', user: users.provider.id },
      user: users.provider,
      overrideAccess: false,
    })

    expect(provider.id).toBeDefined()

    await payload.delete({ collection: 'providers', id: provider.id })
  })

  it('allows an admin to create a Provider document', async () => {
    const provider = await payload.create({
      collection: 'providers',
      data: { name: 'Provider created by admin role', user: users.admin.id },
      user: users.admin,
      overrideAccess: false,
    })

    expect(provider.id).toBeDefined()

    await payload.delete({ collection: 'providers', id: provider.id })
  })

  it('prevents a client from self-escalating their role', async () => {
    const updated = await payload.update({
      collection: 'users',
      id: users.client.id,
      data: { role: 'admin' },
      user: users.client,
      overrideAccess: false,
    })

    expect(updated.role).toBe('client')
  })

  it('allows public self-registration (create with no authenticated user)', async () => {
    const created = await payload.create({
      collection: 'users',
      data: {
        email: 'public-register@test.local',
        password: 'test1234',
        surname: 'Register',
        name: 'Public',
        role: 'client',
      },
      overrideAccess: false,
    })

    expect(created.id).toBeDefined()
    expect(created.role).toBe('client')

    await payload.delete({ collection: 'users', id: created.id })
  })

  it('ignores a role sent during public self-registration (no admin escalation)', async () => {
    const email = 'escalation-register@test.local'
    await payload.delete({ collection: 'users', where: { email: { equals: email } } })

    const created = await payload.create({
      collection: 'users',
      data: {
        email,
        password: 'test1234',
        surname: 'Escalation',
        name: 'Public',
        role: 'admin',
      },
      overrideAccess: false,
      disableVerificationEmail: true,
    })

    try {
      expect(created.role).toBe('client')
    } finally {
      await payload.delete({ collection: 'users', id: created.id })
    }
  })

  it('lets an admin create a user with an elevated role', async () => {
    const email = 'admin-created-provider@test.local'
    await payload.delete({ collection: 'users', where: { email: { equals: email } } })

    const created = await payload.create({
      collection: 'users',
      data: {
        email,
        password: 'test1234',
        surname: 'Provider',
        name: 'Created',
        role: 'provider',
      },
      user: users.admin,
      overrideAccess: false,
      disableVerificationEmail: true,
    })

    try {
      expect(created.role).toBe('provider')
    } finally {
      await payload.delete({ collection: 'users', id: created.id })
    }
  })

  describe('media write access', () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1"/></svg>',
    )
    const testFile = (name: string) => ({
      data: svg,
      mimetype: 'image/svg+xml',
      name,
      size: svg.length,
    })

    it('rejects media uploads from a client', async () => {
      await expect(
        payload.create({
          collection: 'media',
          data: { alt: 'client upload' },
          file: testFile('access-test-client.svg'),
          user: users.client,
          overrideAccess: false,
        }),
      ).rejects.toThrow()
    })

    it('lets a provider upload media, but not a client update or delete it', async () => {
      const media = await payload.create({
        collection: 'media',
        data: { alt: 'provider upload' },
        file: testFile('access-test-provider.svg'),
        user: users.provider,
        overrideAccess: false,
      })

      try {
        expect(media.id).toBeDefined()

        await expect(
          payload.update({
            collection: 'media',
            id: media.id,
            data: { alt: 'hijacked' },
            user: users.client,
            overrideAccess: false,
          }),
        ).rejects.toThrow()

        await expect(
          payload.delete({
            collection: 'media',
            id: media.id,
            user: users.client,
            overrideAccess: false,
          }),
        ).rejects.toThrow()
      } finally {
        await payload.delete({ collection: 'media', id: media.id })
      }
    })
  })

  it("prevents a client from reading another user's record, but allows their own", async () => {
    const ownRead = await payload.find({
      collection: 'users',
      where: { id: { equals: users.client.id } },
      user: users.client,
      overrideAccess: false,
    })
    expect(ownRead.docs).toHaveLength(1)

    const otherRead = await payload.find({
      collection: 'users',
      where: { id: { equals: users.provider.id } },
      user: users.client,
      overrideAccess: false,
    })
    expect(otherRead.docs).toHaveLength(0)

    const adminRead = await payload.find({
      collection: 'users',
      where: { id: { equals: users.client.id } },
      user: users.admin,
      overrideAccess: false,
    })
    expect(adminRead.docs).toHaveLength(1)
  })
})
