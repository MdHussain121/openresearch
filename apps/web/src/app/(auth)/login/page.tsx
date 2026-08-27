'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../context/AuthContext';

type Mode = 'login' | 'register';

export default function LoginPage() {
  const router = useRouter();
  const { login, register, isAuthenticated, isLoading } = useAuth();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isAuthenticated && !isLoading) {
      router.replace('/documents');
    }
  }, [isAuthenticated, isLoading, router]);

  if (isLoading) {
    return null;
  }

  if (isAuthenticated) {
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      if (mode === 'login') {
        await login(email, password);
      } else {
        await register(email, password, name);
      }
      router.push('/documents');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass =
    'w-full rounded-lg border border-border-input bg-canvas px-4 py-2.5 text-sm text-text-primary placeholder:text-text-secondary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent';
  const btnPrimary =
    'w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-accent-solid-fg transition-colors hover:bg-accent/90 disabled:opacity-50';
  const btnSecondary =
    'w-full rounded-lg border border-border-default bg-canvas px-4 py-2.5 text-sm font-medium text-text-primary transition-colors hover:bg-surface-hover';

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-semibold text-text-primary">OpenResearch</h1>
          <p className="mt-1 text-sm text-text-secondary">
            Open-Source AI Academic Research &amp; Writing Assistant
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'register' && (
            <div>
              <label htmlFor="name" className="mb-1 block text-sm font-medium text-text-primary">
                Full Name
              </label>
              <input
                id="name"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Dr. Jane Doe"
                className={inputClass}
              />
            </div>
          )}

          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-medium text-text-primary">
              Email Address
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="jane@university.edu"
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-medium text-text-primary">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === 'register' ? 'Min 8 chars, upper, lower, digit' : 'Your password'}
              minLength={8}
              className={inputClass}
            />
            {mode === 'register' && (
              <p className="mt-1 text-xs text-text-secondary">
                Must contain at least one uppercase letter, one lowercase letter, and one digit.
              </p>
            )}
          </div>

          {error && (
            <div className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
              {error}
            </div>
          )}

          <button type="submit" disabled={submitting} className={btnPrimary}>
            {submitting
              ? 'Please wait...'
              : mode === 'login'
                ? 'Sign In'
                : 'Create Account'}
          </button>
        </form>

        <div className="text-center text-sm text-text-secondary">
          {mode === 'login' ? (
            <>
              Don&apos;t have an account?{' '}
              <button
                type="button"
                onClick={() => {
                  setMode('register');
                  setError('');
                }}
                className="font-medium text-accent hover:underline"
              >
                Register
              </button>
            </>
          ) : (
            <>
              Already have an account?{' '}
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setError('');
                }}
                className="font-medium text-accent hover:underline"
              >
                Sign In
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
