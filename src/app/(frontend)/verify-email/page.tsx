import { getPayload } from 'payload'

import config from '@/payload.config'

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const { token } = await searchParams

  if (!token) {
    return <p>Missing verification token.</p>
  }

  const payloadConfig = await config
  const payload = await getPayload({ config: payloadConfig })

  let verified = false
  try {
    verified = await payload.verifyEmail({ collection: 'users', token })
  } catch {
    verified = false
  }

  if (!verified) {
    return <p>This verification link is invalid or has expired.</p>
  }

  return <p>Your email is verified — you can now log in in the app.</p>
}
