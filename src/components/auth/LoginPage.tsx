import { useState, type FormEvent } from 'react';
import { useAuthStore } from '@/stores/authStore';

type AuthView = 'login' | 'register' | 'profile-switcher';

interface LoginPageProps {
  onNavigate: (view: AuthView) => void;
}

export function LoginPage({ onNavigate }: LoginPageProps) {
  const { login, isLoading, error, clearError } = useAuthStore();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    clearError();
    await login(username, password);
  }

  return (
    <div className="flex items-center justify-center h-screen bg-[#1a1a1a]">
      <div className="w-80 space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-[#e8e8e8]">Auralis DAW</h1>
          <p className="text-[#888888] text-sm mt-1">Sign in to continue</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="text-red-400 text-sm text-center bg-red-900/20 rounded px-3 py-2">
              {error}
            </div>
          )}

          <div className="space-y-1">
            <label htmlFor="login-username" className="block text-xs text-[#888888] uppercase tracking-wide">
              Username
            </label>
            <input
              id="login-username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoComplete="username"
              className="w-full bg-[#2a2a2a] text-[#e8e8e8] rounded px-3 py-2 text-sm border border-[#3a3a3a] focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="login-password" className="block text-xs text-[#888888] uppercase tracking-wide">
              Password
            </label>
            <input
              id="login-password"
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

        <div className="flex flex-col items-center gap-2 text-sm">
          <button
            type="button"
            onClick={() => onNavigate('register')}
            className="text-blue-400 hover:text-blue-300 transition-colors"
          >
            Create new profile
          </button>
          <button
            type="button"
            onClick={() => onNavigate('profile-switcher')}
            className="text-[#888888] hover:text-[#aaaaaa] transition-colors"
          >
            Switch profile
          </button>
        </div>
      </div>
    </div>
  );
}
