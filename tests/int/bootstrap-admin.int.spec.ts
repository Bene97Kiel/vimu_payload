import { getPayload, Payload } from 'payload'
import config from '@/payload.config'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { ensureInitialAdmin } from '@/lib/bootstrapAdmin'

/**
 * Minimal stand-in for the Payload Local API, so the "no admin yet" paths can
 * be tested without demoting the real admins in the shared dev database.
 */
function fakePayload({ adminCount, existingUser }: { adminCount: number; existingUser?: { id: string } }) {
  return {
    count: vi.fn().mockResolvedValue({ totalDocs: adminCount }),
    find: vi.fn().mockResolvedValue({ docs: existingUser ? [existingUser] : [] }),
    create: vi.fn().mockResolvedValue({ id: 'new-admin' }),
    update: vi.fn().mockResolvedValue({}),
    logger: { info: vi.fn(), warn: vi.fn() },
  }
}

const asPayload = (fake: ReturnType<typeof fakePayload>) => fake as unknown as Payload

describe('ensureInitialAdmin', () => {
  describe('against the real database', () => {
    let payload: Payload
    // Own fixture email: test files run in parallel, so sharing seedRoleUsers()
    // with access-control.int.spec.ts would race on the same emails.
    const fixtureEmail = 'bootstrap-fixture-admin@test.local'

    beforeAll(async () => {
      payload = await getPayload({ config: await config })
      await payload.delete({ collection: 'users', where: { email: { equals: fixtureEmail } } })
      // Guarantees at least one admin exists.
      await payload.create({
        collection: 'users',
        data: { email: fixtureEmail, password: 'test1234', name: 'Fixture', surname: 'Admin', role: 'admin' },
        disableVerificationEmail: true,
      })
    })

    afterAll(async () => {
      await payload.delete({ collection: 'users', where: { email: { equals: fixtureEmail } } })
    })

    it('does nothing when an admin already exists', async () => {
      const email = 'bootstrap-should-not-exist@test.local'

      const result = await ensureInitialAdmin(payload, {
        ADMIN_EMAIL: email,
        ADMIN_PASSWORD: 'test1234',
      })

      expect(result).toBe('admin-exists')
      const { totalDocs } = await payload.count({
        collection: 'users',
        where: { email: { equals: email } },
      })
      expect(totalDocs).toBe(0)
    })
  })

  describe('when no admin exists', () => {
    it('creates a verified admin from the env vars', async () => {
      const fake = fakePayload({ adminCount: 0 })

      const result = await ensureInitialAdmin(asPayload(fake), {
        ADMIN_EMAIL: ' Admin@Example.com ',
        ADMIN_PASSWORD: 'secret',
      })

      expect(result).toBe('created')
      expect(fake.create).toHaveBeenCalledWith(
        expect.objectContaining({
          collection: 'users',
          overrideAccess: true,
          disableVerificationEmail: true,
          data: expect.objectContaining({
            email: 'admin@example.com',
            password: 'secret',
            role: 'admin',
            _verified: true,
          }),
        }),
      )
    })

    it('promotes an existing user with that email instead of creating a duplicate', async () => {
      const fake = fakePayload({ adminCount: 0, existingUser: { id: 'u1' } })

      const result = await ensureInitialAdmin(asPayload(fake), {
        ADMIN_EMAIL: 'admin@example.com',
        ADMIN_PASSWORD: 'secret',
      })

      expect(result).toBe('promoted-existing-user')
      expect(fake.create).not.toHaveBeenCalled()
      expect(fake.update).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'u1',
          data: { role: 'admin', _verified: true },
          overrideAccess: true,
        }),
      )
    })

    it('warns and skips when ADMIN_EMAIL is not set', async () => {
      const fake = fakePayload({ adminCount: 0 })

      const result = await ensureInitialAdmin(asPayload(fake), {})

      expect(result).toBe('skipped-no-env')
      expect(fake.create).not.toHaveBeenCalled()
      expect(fake.logger.warn).toHaveBeenCalled()
    })

    it('warns and skips when ADMIN_PASSWORD is missing for a new user', async () => {
      const fake = fakePayload({ adminCount: 0 })

      const result = await ensureInitialAdmin(asPayload(fake), { ADMIN_EMAIL: 'admin@example.com' })

      expect(result).toBe('skipped-no-env')
      expect(fake.create).not.toHaveBeenCalled()
    })
  })
})
