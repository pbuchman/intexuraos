import type { JSX } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '@/context';
import { FullPageSpinner } from './FullPageSpinner.js';

export function ProtectedLayout(): JSX.Element {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading === true) {
    return <FullPageSpinner />;
  }

  if (isAuthenticated !== true) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}
