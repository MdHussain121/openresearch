'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../../context/AuthContext';
import { BookOpen, FileText, Users, Sparkles, AlertTriangle } from 'lucide-react';

type Mode = 'login' | 'register';

/** Validate password matches backend schema rules. */
function validatePassword(pw: string): string | null {
  if (pw.length < 8) return 'Password must be at least 8 characters long.';
  if (pw.length > 128) return 'Password must be at most 128 characters.';
  if (!/[a-z]/.test(pw)) return 'Password must contain at least one lowercase letter.';
  if (!/[A-Z]/.test(pw)) return 'Password must contain at least one uppercase letter.';
  if (!/\d/.test(pw)) return 'Password must contain at least one digit.';
  return null;
}

/** Check if an error message indicates a rate-limit (429) response. */
function isRateLimitError(message: string): boolean {
  return /rate.?limit|too many|429/i.test(message);
}

export default function LoginPage() {
  const router = useRouter();
  const { login, register, isAuthenticated, isLoading } = useAuth();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (isAuthenticated && !isLoading) {
      router.replace('/documents');
    }
  }, [isAuthenticated, isLoading, router]);

  if (isLoading || !mounted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas">
        <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (isAuthenticated) {
    return null;
  }

  /** Clear all fields when switching between login ↔ register. */
  const switchMode = (newMode: Mode) => {
    setMode(newMode);
    setError('');
    setEmail('');
    setPassword('');
    setConfirmPassword('');
    setName('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // --- Client-side validation ---
    if (mode === 'register') {
      if (!name.trim()) {
        setError('Please enter your full name.');
        return;
      }
      const pwError = validatePassword(password);
      if (pwError) {
        setError(pwError);
        return;
      }
      if (password !== confirmPassword) {
        setError('Passwords do not match.');
        return;
      }
    }

    setSubmitting(true);
    try {
      if (mode === 'login') {
        await login(email, password);
      } else {
        await register(email, password, name);
      }
      router.push('/documents');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Something went wrong';
      if (isRateLimitError(msg)) {
        setError('Too many attempts. Please wait a moment and try again.');
      } else {
        setError(msg);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass =
    'w-full rounded-lg border border-border-input bg-canvas px-4 py-3 text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 transition-all duration-200';

  const features = [
    { icon: FileText, title: 'Academic Writing', desc: 'AI-powered research writing with citation support' },
    { icon: BookOpen, title: 'Literature Discovery', desc: 'Find and manage relevant papers effortlessly' },
    { icon: Users, title: 'Collaboration', desc: 'Work together on research projects in real-time' },
    { icon: Sparkles, title: 'Intelligent Assistant', desc: 'Context-aware AI that understands your research' },
  ];

  return (
    <div className="flex min-h-screen bg-canvas">
      {/* Left Panel - Branding & Features */}
      <div className="hidden lg:flex lg:w-1/2 xl:w-[55%] relative overflow-hidden bg-gradient-to-br from-surface via-surface to-accent/5">
        {/* Subtle pattern overlay */}
        <div className="absolute inset-0 opacity-[0.03]" style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23000000' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
        }} />

        <div className="relative z-10 flex flex-col justify-center px-12 xl:px-16 max-w-xl">
          {/* Logo */}
          <div className="mb-12 animate-fade-slide-in" style={{ animationDelay: '100ms' }}>
            <div className="flex items-center space-x-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-accent flex items-center justify-center">
                <BookOpen className="w-5 h-5 text-accent-solid-fg" />
              </div>
              <span className="text-2xl font-semibold text-text-primary font-serif tracking-tight">
                OpenResearch
              </span>
            </div>
            <p className="text-text-secondary text-lg leading-relaxed">
              The open-source AI platform for academic research and writing.
            </p>
          </div>

          {/* Feature Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {features.map((feature, idx) => (
              <div
                key={feature.title}
                className="p-4 rounded-xl bg-surface/60 backdrop-blur-sm border border-border-default/50 animate-fade-slide-in"
                style={{ animationDelay: `${200 + idx * 100}ms` }}
              >
                <feature.icon className="w-5 h-5 text-accent mb-2" />
                <h3 className="text-sm font-medium text-text-primary mb-1">{feature.title}</h3>
                <p className="text-xs text-text-secondary leading-relaxed">{feature.desc}</p>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div className="mt-12 pt-6 border-t border-border-default/50">
            <p className="text-xs text-text-tertiary">
              Trusted by researchers at leading institutions worldwide
            </p>
          </div>
        </div>
      </div>

      {/* Right Panel - Auth Form */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-8">
        <div className="w-full max-w-sm">
          {/* Mobile Logo */}
          <div className="lg:hidden mb-8 text-center animate-fade-slide-in">
            <div className="inline-flex items-center space-x-2 mb-3">
              <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center">
                <BookOpen className="w-4 h-4 text-accent-solid-fg" />
              </div>
              <span className="text-xl font-semibold text-text-primary font-serif tracking-tight">
                OpenResearch
              </span>
            </div>
            <p className="text-sm text-text-secondary">
              AI-Powered Research Assistant
            </p>
          </div>

          {/* Form Card */}
          <div className="animate-fade-slide-in" style={{ animationDelay: '150ms' }}>
            <div className="mb-8">
              <h1 className="text-2xl font-semibold text-text-primary mb-2">
                {mode === 'login' ? 'Welcome back' : 'Create your account'}
              </h1>
              <p className="text-sm text-text-secondary">
                {mode === 'login'
                  ? 'Sign in to continue your research'
                  : 'Join thousands of researchers using AI'}
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5" noValidate>
              {mode === 'register' && (
                <div className="animate-fade-slide-in">
                  <label htmlFor="name" className="block text-sm font-medium text-text-primary mb-2">
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
                    autoComplete="name"
                    autoFocus
                  />
                </div>
              )}

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
                  autoComplete={mode === 'login' ? 'username email' : 'email'}
                  autoFocus={mode === 'login'}
                />
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-medium text-text-primary mb-2">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === 'register' ? 'Min 8 chars, upper, lower, digit' : 'Enter your password'}
                  minLength={8}
                  className={inputClass}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                />
                {mode === 'login' && (
                  <div className="mt-2 text-right">
                    <button
                      type="button"
                      onClick={() => router.push('/forgot-password')}
                      className="text-xs text-accent hover:underline"
                    >
                      Forgot Password?
                    </button>
                  </div>
                )}
                {mode === 'register' && (
                  <p className="mt-1.5 text-xs text-text-tertiary">
                    Must contain at least one uppercase letter, one lowercase letter, and one digit.
                  </p>
                )}
              </div>

              {mode === 'register' && (
                <div className="animate-fade-slide-in">
                  <label htmlFor="confirmPassword" className="block text-sm font-medium text-text-primary mb-2">
                    Confirm Password
                  </label>
                  <input
                    id="confirmPassword"
                    type="password"
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter your password"
                    minLength={8}
                    className={inputClass}
                    autoComplete="new-password"
                  />
                </div>
              )}

              {error && (
                <div className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger flex items-start space-x-2" role="alert">
                  {isRateLimitError(error) ? (
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-danger" />
                  ) : (
                    <span className="text-danger mt-0.5">•</span>
                  )}
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
                <span>
                  {submitting
                    ? 'Please wait...'
                    : mode === 'login'
                      ? 'Sign In'
                      : 'Create Account'}
                </span>
              </button>
            </form>

            {/* Divider */}
            <div className="relative my-8">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border-default" />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="bg-canvas px-3 text-text-tertiary">
                  {mode === 'login' ? 'New to OpenResearch?' : 'Already have an account?'}
                </span>
              </div>
            </div>

            {/* Toggle Mode */}
            <button
              type="button"
              onClick={() => switchMode(mode === 'login' ? 'register' : 'login')}
              className="w-full rounded-lg border border-border-default bg-surface px-4 py-3 text-sm font-medium text-text-primary transition-all duration-200 hover:bg-surface-hover active:scale-[0.98]"
            >
              {mode === 'login' ? 'Create an Account' : 'Sign In Instead'}
            </button>

            {/* Terms */}
            <p className="mt-6 text-center text-xs text-text-tertiary leading-relaxed">
              By continuing, you agree to our{' '}
              <span className="text-text-secondary hover:underline cursor-pointer">Terms of Service</span>
              {' '}and{' '}
              <span className="text-text-secondary hover:underline cursor-pointer">Privacy Policy</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
