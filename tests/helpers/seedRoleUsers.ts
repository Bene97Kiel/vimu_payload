import { getPayload } from 'payload'
import config from '../../src/payload.config.js'

export const roleTestUsers = {
  client: {
    email: 'client@test.local',
    password: 'test1234',
    surname: 'Client',
    name: 'Test',
    role: 'client' as const,
  },
  provider: {
    email: 'provider@test.local',
    password: 'test1234',
    surname: 'Provider',
    name: 'Test',
    role: 'provider' as const,
  },
  admin: {
    email: 'admin@test.local',
    password: 'test1234',
    surname: 'Admin',
    name: 'Test',
    role: 'admin' as const,
  },
}

/**
 * Seeds one test user per role (client/provider/admin) for access-control tests,
 * returning their created documents (including IDs) so tests can build fixtures.
 */
export async function seedRoleUsers() {
  const payload = await getPayload({ config })

  await cleanupRoleUsers()

  const client = await payload.create({
    collection: 'users',
    data: roleTestUsers.client,
    disableVerificationEmail: true,
  })
  const provider = await payload.create({
    collection: 'users',
    data: roleTestUsers.provider,
    disableVerificationEmail: true,
  })
  const admin = await payload.create({
    collection: 'users',
    data: roleTestUsers.admin,
    disableVerificationEmail: true,
  })

  return { client, provider, admin }
}

export async function cleanupRoleUsers(): Promise<void> {
  const payload = await getPayload({ config })

  await payload.delete({
    collection: 'users',
    where: {
      email: {
        in: [roleTestUsers.client.email, roleTestUsers.provider.email, roleTestUsers.admin.email],
      },
    },
  })
}
