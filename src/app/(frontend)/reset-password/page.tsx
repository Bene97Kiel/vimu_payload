'use client'

import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  )
}

function ResetPasswordForm() {
  const searchParams = useSearchParams()
  const token = searchParams.get('token')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle')
  const [error, setError] = useState('')

  if (!token) {
    return <p>Missing reset token.</p>
  }

  if (status === 'success') {
    return <p>Your password has been reset — you can now log in in the app.</p>
  }

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setStatus('submitting')
    setError('')

    const response = await fetch('/api/users/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password }),
    })

    if (response.ok) {
      setStatus('success')
    } else {
      setStatus('error')
      setError('This reset link is invalid or has expired.')
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <h1>Reset your password</h1>
      <label htmlFor="password">New password</label>
      <input
        id="password"
        type="password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        required
      />
      <label htmlFor="confirmPassword">Confirm new password</label>
      <input
        id="confirmPassword"
        type="password"
        value={confirmPassword}
        onChange={(event) => setConfirmPassword(event.target.value)}
        required
      />
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={status === 'submitting'}>
        Reset password
      </button>
    </form>
  )
}
