'use client'

import { useState } from 'react'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState<
    'idle' | 'submitting' | 'error' | 'confirming' | 'upgrading' | 'declined'
  >('idle')
  const [error, setError] = useState('')

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    setStatus('submitting')
    setError('')

    const response = await fetch('/api/users/login-provider', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password }),
    })

    const data = await response.json().catch(() => null)

    if (response.ok && data?.needsUpgradeConfirmation) {
      setStatus('confirming')
      return
    }

    if (response.ok) {
      window.location.href = '/admin'
      return
    }

    setStatus('error')
    setError(data?.errors?.[0]?.message ?? 'Login failed.')
  }

  const onConfirmUpgrade = async () => {
    setStatus('upgrading')
    setError('')

    const response = await fetch('/api/users/confirm-provider-upgrade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password }),
    })

    if (response.ok) {
      window.location.href = '/admin'
      return
    }

    const data = await response.json().catch(() => null)
    setStatus('error')
    setError(data?.errors?.[0]?.message ?? 'Could not complete the upgrade.')
  }

  if (status === 'confirming' || status === 'upgrading') {
    return (
      <div>
        <h1>Become a provider?</h1>
        <p>You have a client account. Do you want to become a provider?</p>
        <button onClick={onConfirmUpgrade} disabled={status === 'upgrading'}>
          Yes, become a provider
        </button>
        <button onClick={() => setStatus('declined')} disabled={status === 'upgrading'}>
          No
        </button>
      </div>
    )
  }

  if (status === 'declined') {
    return <p>No problem — see you in the app.</p>
  }

  return (
    <form onSubmit={onSubmit}>
      <h1>Provider login</h1>
      <label htmlFor="email">Email</label>
      <input
        id="email"
        type="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        required
      />
      <label htmlFor="password">Password</label>
      <input
        id="password"
        type="password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        required
      />
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={status === 'submitting'}>
        Log in
      </button>
    </form>
  )
}
