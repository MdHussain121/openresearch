'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Auth removed — redirect immediately to workspace
export default function ForgotPasswordPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/documents');
  }, [router]);
  return null;
}
