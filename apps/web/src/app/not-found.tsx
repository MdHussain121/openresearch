import React from 'react';
import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] p-8 text-center">
      <h2 className="text-lg font-semibold text-text-primary mb-2">Page not found</h2>
      <p className="text-sm text-text-secondary mb-4">
        The page you are looking for does not exist.
      </p>
      <Link
        href="/documents"
        className="px-4 py-2 rounded bg-accent text-accent-solid-fg text-sm font-medium hover:bg-accent/90 transition-colors"
      >
        Go to documents
      </Link>
    </div>
  );
}
