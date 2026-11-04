'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Warehouse } from 'lucide-react'
import { authClient } from '@/lib/auth-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function AuthForm({ mode }: { mode: 'sign-in' | 'sign-up' }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const isSignUp = mode === 'sign-up'

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    setLoading(true)
    const { error: authError } = isSignUp
      ? await authClient.signUp.email({ email, password, name })
      : await authClient.signIn.email({ email, password })
    setLoading(false)

    if (authError) {
      setError(
        isSignUp
          ? 'Could not create the account. Check your details or try a different email.'
          : 'Incorrect email or password.',
      )
      return
    }
    router.push('/')
    router.refresh()
  }

  return (
    <main className="flex min-h-dvh flex-col lg:flex-row">
      <section className="flex flex-col justify-between gap-8 bg-sidebar px-6 py-8 text-sidebar-foreground lg:w-[42%] lg:px-12 lg:py-12">
        <div className="flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
            <Warehouse className="size-5" />
          </span>
          <div className="leading-tight">
            <p className="text-sm font-semibold text-sidebar-primary">SiteStock ERP</p>
            <p className="text-xs text-sidebar-foreground/80">Site-wise inventory</p>
          </div>
        </div>
        <div className="hidden flex-col gap-3 lg:flex">
          <h2 className="text-3xl font-semibold leading-tight text-balance">
            Every site&apos;s material, counted separately and accurately.
          </h2>
          <p className="max-w-sm text-sm leading-relaxed text-sidebar-foreground/80 text-pretty">
            Track Stock IN, Stock OUT and live balances for each site from one place.
          </p>
        </div>
        <p className="hidden text-xs text-sidebar-foreground/70 lg:block">Authorized team members only</p>
      </section>

      <section className="flex flex-1 items-center justify-center bg-background px-6 py-10">
        <div className="flex w-full max-w-sm flex-col gap-6">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              {isSignUp ? 'Create your account' : 'Sign in'}
            </h1>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {isSignUp ? 'Set up a login to manage site inventory.' : 'Enter your email and password to continue.'}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {isSignUp && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="name">Full name</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                  autoComplete="name"
                  className="h-10"
                />
              </div>
            )}
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                autoComplete="email"
                className="h-10"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                minLength={8}
                autoComplete={isSignUp ? 'new-password' : 'current-password'}
                className="h-10"
              />
              {isSignUp && <p className="text-xs text-muted-foreground">At least 8 characters.</p>}
            </div>

            {error && (
              <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}

            <Button type="submit" size="lg" disabled={loading} className="w-full">
              {loading ? 'Please wait...' : isSignUp ? 'Create account' : 'Sign in'}
            </Button>
          </form>

          <p className="text-center text-sm text-muted-foreground">
            {isSignUp ? 'Already have an account? ' : "Don't have an account? "}
            <Link
              href={isSignUp ? '/sign-in' : '/sign-up'}
              className="font-medium text-foreground underline-offset-4 hover:underline"
            >
              {isSignUp ? 'Sign in' : 'Sign up'}
            </Link>
          </p>
        </div>
      </section>
    </main>
  )
}
