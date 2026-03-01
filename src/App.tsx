import { useEffect } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { AuthScreen } from '@/components/auth/AuthScreen';
import { DAWLayout } from '@/components/daw/DAWLayout';

export default function App() {
  const { isAuthenticated, isHydrating, hydrateFromStorage } = useAuthStore();

  useEffect(() => {
    void hydrateFromStorage();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (isHydrating) {
    return (
      <div className="h-screen bg-[#1a1a1a] flex items-center justify-center text-[#888888] text-sm">
        Loading...
      </div>
    );
  }

  return isAuthenticated ? <DAWLayout /> : <AuthScreen />;
}
