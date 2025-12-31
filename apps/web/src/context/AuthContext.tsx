import { createContext, type ReactNode, useContext, useMemo } from 'react';
import { useAuth0, type User } from '@auth0/auth0-react';

interface AuthContextValue {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: User | undefined;
  login: () => void;
  logout: () => void;
  getAccessToken: () => Promise<string>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps): React.JSX.Element {
  const {
    isAuthenticated,
    isLoading,
    user,
    loginWithRedirect,
    logout: auth0Logout,
    getAccessTokenSilently,
  } = useAuth0();

  const value = useMemo(
    (): AuthContextValue => ({
      isAuthenticated,
      isLoading,
      user,
      login: (): void => {
        void loginWithRedirect();
      },
      logout: (): void => {
        void auth0Logout({
          logoutParams: {
            returnTo: window.location.origin,
          },
        });
      },
      getAccessToken: async (): Promise<string> => {
        return await getAccessTokenSilently();
      },
    }),
    [isAuthenticated, isLoading, user, loginWithRedirect, auth0Logout, getAccessTokenSilently]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === null) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
