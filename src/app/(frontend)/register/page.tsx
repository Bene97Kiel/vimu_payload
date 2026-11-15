'use client'

import { useState } from 'react'

export default function RegisterPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [surname, setSurname] = useState('')
  const [nickname, setNickname] = useState('')
  const [lastname, setLastname] = useState('')
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle')
  const [error, setError] = useState('')

  if (status === 'success') {
    return <p>Check your email to verify your account, then log in.</p>
  }

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    setStatus('submitting')
    setError('')

    const response = await fetch('/api/users/register-provider', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name, surname, nickname, lastname }),
    })

    if (response.ok) {
      setStatus('success')
    } else {
      const data = await response.json().catch(() => null)
      setStatus('error')
      setError(data?.errors?.[0]?.message ?? 'Registration failed.')
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <h1>Register as a provider</h1>
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
      <label htmlFor="name">First name</label>
      <input
        id="name"
        type="text"
        value={name}
        onChange={(event) => setName(event.target.value)}
        required
      />
      <label htmlFor="surname">Surname</label>
      <input
        id="surname"
        type="text"
        value={surname}
        onChange={(event) => setSurname(event.target.value)}
        required
      />
      <label htmlFor="nickname">Nickname (optional)</label>
      <input
        id="nickname"
        type="text"
        value={nickname}
        onChange={(event) => setNickname(event.target.value)}
      />
      <label htmlFor="lastname">Last name (optional)</label>
      <input
        id="lastname"
        type="text"
        value={lastname}
        onChange={(event) => setLastname(event.target.value)}
      />
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={status === 'submitting'}>
        Register
      </button>
    </form>
  )
}
