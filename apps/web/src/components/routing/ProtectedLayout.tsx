import type { JSX } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '@/context';
import { FullPageSpinner } from './FullPageSpinner.js';

export function ProtectedLayout(): JSX.Element {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return <FullPageSpinner />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}
