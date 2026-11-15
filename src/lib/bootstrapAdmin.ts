import type { Payload } from 'payload'

export type BootstrapAdminResult =
  | 'skipped-no-env'
  | 'admin-exists'
  | 'promoted-existing-user'
  | 'created'

/** Reads ADMIN_EMAIL, ADMIN_PASSWORD and optional ADMIN_NAME / ADMIN_SURNAME. */
type AdminEnv = Record<string, string | undefined>

/**
 * Creates the first admin from env vars, but only while no admin exists yet.
 *
 * The env vars bootstrap an empty database (fresh deployment, new dev machine).
 * They do not keep the admin in sync afterwards: once any admin exists this is
 * a no-op, so changing the password in /admin sticks and more admins can be
 * added there. After the first start, ADMIN_PASSWORD can be removed from .env.
 *
 * If a user with ADMIN_EMAIL already exists (e.g. registered via the app), that
 * user is promoted to admin and marked verified; their password is left alone.
 */
export async function ensureInitialAdmin(
  payload: Payload,
  env: AdminEnv = process.env,
): Promise<BootstrapAdminResult> {
  const email = env.ADMIN_EMAIL?.trim().toLowerCase()
  const password = env.ADMIN_PASSWORD

  const { totalDocs: adminCount } = await payload.count({
    collection: 'users',
    where: { role: { equals: 'admin' } },
    overrideAccess: true,
  })

  if (adminCount > 0) return 'admin-exists'

  if (!email) {
    payload.logger.warn(
      'No admin user exists and ADMIN_EMAIL is not set. Set ADMIN_EMAIL and ADMIN_PASSWORD in .env to create one at startup.',
    )
    return 'skipped-no-env'
  }

  const { docs: existing } = await payload.find({
    collection: 'users',
    where: { email: { equals: email } },
    limit: 1,
    overrideAccess: true,
  })

  if (existing[0]) {
    await payload.update({
      collection: 'users',
      id: existing[0].id,
      data: { role: 'admin', _verified: true },
      overrideAccess: true,
    })
    payload.logger.info(`Promoted existing user ${email} to admin (no admin existed).`)
    return 'promoted-existing-user'
  }

  if (!password) {
    payload.logger.warn(
      `No admin user exists and ADMIN_PASSWORD is not set, so ${email} could not be created.`,
    )
    return 'skipped-no-env'
  }

  await payload.create({
    collection: 'users',
    data: {
      email,
      password,
      name: env.ADMIN_NAME?.trim() || 'Admin',
      surname: env.ADMIN_SURNAME?.trim() || 'ViMu',
      role: 'admin',
      _verified: true,
    },
    overrideAccess: true,
    disableVerificationEmail: true,
  })
  payload.logger.info(`Created initial admin ${email} from ADMIN_EMAIL / ADMIN_PASSWORD.`)
  return 'created'
}
