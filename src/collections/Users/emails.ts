import type { PayloadRequest } from 'payload'

export const verifyEmailHTML = ({ req, token }: { req: PayloadRequest; token: string }) => {
  const url = `${req.payload.config.serverURL}/verify-email?token=${token}`
  return `<a href="${url}">${url}</a>`
}

export const resetPasswordEmailHTML = (
  args: { req?: PayloadRequest; token?: string } = {},
) => {
  const url = `${args.req?.payload.config.serverURL ?? ''}/reset-password?token=${args.token ?? ''}`
  return `<a href="${url}">${url}</a>`
}
