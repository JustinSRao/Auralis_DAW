import { useEffect, useState } from 'react';
import { useAuthStore } from '@/stores/authStore';
import type { User } from '@/lib/ipc';

type LoginView = 'login';

interface ProfileSwitcherProps {
  onNavigate: (view: LoginView) => void;
}

export function ProfileSwitcher({ onNavigate }: ProfileSwitcherProps) {
  const { users, isLoading, error, loadUsers, login, clearError } = useAuthStore();
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [password, setPassword] = useState('');

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  async function handleLogin(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selectedUser) return;
    clearError();
    await login(selectedUser.username, password);
  }

  return (
    <div className="flex items-center justify-center h-screen bg-[#1a1a1a]">
      <div className="w-80 space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-[#e8e8e8]">Switch Profile</h1>
          <p className="text-[#888888] text-sm mt-1">Select an account</p>
        </div>

        {users.length === 0 ? (
          <p className="text-[#888888] text-sm text-center">No profiles found.</p>
        ) : (
          <ul className="space-y-2">
            {users.map((user) => (
              <li key={user.id}>
                <button
                  type="button"
                  onClick={() => { setSelectedUser(user); setPassword(''); clearError(); }}
                  className={`w-full text-left px-4 py-3 rounded border transition-colors ${
                    selectedUser?.id === user.id
                      ? 'bg-blue-900/30 border-blue-500 text-[#e8e8e8]'
                      : 'bg-[#2a2a2a] border-[#3a3a3a] text-[#cccccc] hover:border-[#555555]'
                  }`}
                >
                  <span className="font-medium">{user.username}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {selectedUser && (
          <form onSubmit={handleLogin} className="space-y-3">
            {error && (
              <div className="text-red-400 text-sm text-center bg-red-900/20 rounded px-3 py-2">
                {error}
              </div>
            )}
            <div className="space-y-1">
              <label htmlFor="switcher-password" className="block text-xs text-[#888888] uppercase tracking-wide">
                Password for {selectedUser.username}
              </label>
              <input
                id="switcher-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="w-full bg-[#2a2a2a] text-[#e8e8e8] rounded px-3 py-2 text-sm border border-[#3a3a3a] focus:border-blue-500 focus:outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded px-4 py-2 text-sm font-medium transition-colors"
            >
              {isLoading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
        )}

        <div className="text-center">
          <button
            type="button"
            onClick={() => onNavigate('login')}
            className="text-blue-400 hover:text-blue-300 text-sm transition-colors"
          >
            Back to sign in
          </button>
        </div>
      </div>
    </div>
  );
}
