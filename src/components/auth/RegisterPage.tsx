import { useState, type FormEvent } from 'react';
import { useAuthStore } from '@/stores/authStore';

type LoginView = 'login';

interface RegisterPageProps {
  onNavigate: (view: LoginView) => void;
}

export function RegisterPage({ onNavigate }: RegisterPageProps) {
  const { register, isLoading, error, clearError } = useAuthStore();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setValidationError(null);
    clearError();

    if (password.length < 8) {
      setValidationError('Password must be at least 8 characters');
      return;
    }
    if (password !== confirmPassword) {
      setValidationError('Passwords do not match');
      return;
    }

    await register(username, password);
  }

  const displayError = validationError ?? error;

  return (
    <div className="flex items-center justify-center h-screen bg-[#1a1a1a]">
      <div className="w-80 space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-[#e8e8e8]">Create Profile</h1>
          <p className="text-[#888888] text-sm mt-1">Set up your local account</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {displayError && (
            <div className="text-red-400 text-sm text-center bg-red-900/20 rounded px-3 py-2">
              {displayError}
            </div>
          )}

          <div className="space-y-1">
            <label htmlFor="reg-username" className="block text-xs text-[#888888] uppercase tracking-wide">
              Username
            </label>
            <input
              id="reg-username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoComplete="username"
              className="w-full bg-[#2a2a2a] text-[#e8e8e8] rounded px-3 py-2 text-sm border border-[#3a3a3a] focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="reg-password" className="block text-xs text-[#888888] uppercase tracking-wide">
              Password
            </label>
            <input
              id="reg-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="new-password"
              className="w-full bg-[#2a2a2a] text-[#e8e8e8] rounded px-3 py-2 text-sm border border-[#3a3a3a] focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="reg-confirm" className="block text-xs text-[#888888] uppercase tracking-wide">
              Confirm Password
            </label>
            <input
              id="reg-confirm"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              autoComplete="new-password"
              className="w-full bg-[#2a2a2a] text-[#e8e8e8] rounded px-3 py-2 text-sm border border-[#3a3a3a] focus:border-blue-500 focus:outline-none"
            />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded px-4 py-2 text-sm font-medium transition-colors"
          >
            {isLoading ? 'Creating...' : 'Create Profile'}
          </button>
        </form>

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
