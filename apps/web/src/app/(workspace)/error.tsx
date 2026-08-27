'use client';

import React from 'react';

export default function WorkspaceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] p-8 text-center">
      <h2 className="text-lg font-semibold text-text-primary mb-2">Something went wrong</h2>
      <p className="text-sm text-text-secondary mb-4 max-w-md">
        {error.message || 'An unexpected error occurred while loading this page.'}
      </p>
      <button
        onClick={reset}
        className="px-4 py-2 rounded bg-accent text-accent-solid-fg text-sm font-medium hover:bg-accent/90 transition-colors"
      >
        Try again
      </button>
    </div>
  );
}
