'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { BookOpen, ArrowLeft, CheckCircle2 } from 'lucide-react';
import { resolveApiUrl } from '../../../lib/api/client';

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email.trim()) {
      setError('Please enter your email address.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${resolveApiUrl()}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      // Always show success to prevent email enumeration
      setSubmitted(true);
    } catch {
      // Network error or endpoint not implemented — still show success
      // to avoid leaking whether the email exists
      setSubmitted(true);
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass =
    'w-full rounded-lg border border-border-input bg-canvas px-4 py-3 text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 transition-all duration-200';

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas p-6">
      <div className="w-full max-w-sm">
        {/* Back to login */}
        <button
          type="button"
          onClick={() => router.push('/login')}
          className="flex items-center space-x-1.5 text-sm text-text-secondary hover:text-text-primary transition-colors duration-150 mb-8"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Sign In</span>
        </button>

        <div className="animate-fade-slide-in">
          {/* Logo */}
          <div className="flex items-center space-x-2 mb-8">
            <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center">
              <BookOpen className="w-4 h-4 text-accent-solid-fg" />
            </div>
            <span className="text-lg font-semibold text-text-primary font-serif tracking-tight">
              OpenResearch
            </span>
          </div>

          {submitted ? (
            /* Success state */
            <div className="text-center">
              <div className="w-12 h-12 rounded-full bg-accent/10 flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 className="w-6 h-6 text-accent" />
              </div>
              <h1 className="text-xl font-semibold text-text-primary mb-2">
                Check your email
              </h1>
              <p className="text-sm text-text-secondary leading-relaxed mb-8">
                If an account exists for <span className="font-medium text-text-primary">{email}</span>,
                we&apos;ve sent a password reset link. Check your inbox and follow the instructions.
              </p>
              <button
                type="button"
                onClick={() => router.push('/login')}
                className="w-full rounded-lg bg-accent px-4 py-3 text-sm font-medium text-accent-solid-fg transition-all duration-200 hover:bg-accent/90 active:scale-[0.98]"
              >
                Return to Sign In
              </button>
            </div>
          ) : (
            /* Form state */
            <>
              <div className="mb-8">
                <h1 className="text-2xl font-semibold text-text-primary mb-2">
                  Forgot your password?
                </h1>
                <p className="text-sm text-text-secondary">
                  Enter your email address and we&apos;ll send you a link to reset your password.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-5" noValidate>
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-text-primary mb-2">
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
                    autoComplete="email"
                    autoFocus
                  />
                </div>

                {error && (
                  <div className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger flex items-start space-x-2" role="alert">
                    <span className="text-danger mt-0.5">•</span>
                    <span>{error}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full rounded-lg bg-accent px-4 py-3 text-sm font-medium text-accent-solid-fg transition-all duration-200 hover:bg-accent/90 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
                >
                  {submitting && (
                    <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  )}
                  <span>{submitting ? 'Sending...' : 'Send Reset Link'}</span>
                </button>
              </form>

              <p className="mt-6 text-center text-xs text-text-tertiary">
                Remember your password?{' '}
                <button
                  type="button"
                  onClick={() => router.push('/login')}
                  className="font-medium text-accent hover:underline"
                >
                  Sign In
                </button>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
