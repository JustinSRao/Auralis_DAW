import { useState } from 'react';
import { LoginPage } from './LoginPage';
import { RegisterPage } from './RegisterPage';
import { ProfileSwitcher } from './ProfileSwitcher';

type AuthView = 'login' | 'register' | 'profile-switcher';

export function AuthScreen() {
  const [view, setView] = useState<AuthView>('login');

  if (view === 'register') {
    return <RegisterPage onNavigate={setView} />;
  }

  if (view === 'profile-switcher') {
    return <ProfileSwitcher onNavigate={setView} />;
  }

  return <LoginPage onNavigate={setView} />;
}
