import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import {
  ipcLogin,
  ipcRegister,
  ipcLogout,
  ipcListUsers,
  ipcGetCurrentUser,
  type User,
} from '../lib/ipc';

interface AuthState {
  isAuthenticated: boolean;
  isHydrating: boolean;
  isLoading: boolean;
  currentUser: User | null;
  users: User[];
  error: string | null;

  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  hydrateFromStorage: () => Promise<void>;
  loadUsers: () => Promise<void>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    immer((set, get) => ({
      isAuthenticated: false,
      isHydrating: false,
      isLoading: false,
      currentUser: null,
      users: [],
      error: null,

      login: async (username, password) => {
        set((s) => { s.isLoading = true; s.error = null; });
        try {
          const response = await ipcLogin(username, password);
          if (response.success && response.user) {
            set((s) => {
              s.isAuthenticated = true;
              s.currentUser = response.user!;
              s.isLoading = false;
            });
          } else {
            set((s) => {
              s.error = response.error ?? 'Login failed';
              s.isLoading = false;
            });
          }
        } catch (err) {
          set((s) => {
            s.error = err instanceof Error ? err.message : 'Login failed';
            s.isLoading = false;
          });
        }
      },

      logout: async () => {
        await ipcLogout().catch(() => { /* no-op on failure */ });
        set((s) => {
          s.isAuthenticated = false;
          s.currentUser = null;
          s.users = [];
          s.error = null;
        });
      },

      register: async (username, password) => {
        set((s) => { s.isLoading = true; s.error = null; });
        try {
          const response = await ipcRegister(username, password);
          if (response.success && response.user) {
            set((s) => {
              s.isAuthenticated = true;
              s.currentUser = response.user!;
              s.isLoading = false;
            });
          } else {
            set((s) => {
              s.error = response.error ?? 'Registration failed';
              s.isLoading = false;
            });
          }
        } catch (err) {
          set((s) => {
            s.error = err instanceof Error ? err.message : 'Registration failed';
            s.isLoading = false;
          });
        }
      },

      hydrateFromStorage: async () => {
        const { currentUser } = get();
        if (!currentUser) return;

        set((s) => { s.isHydrating = true; });
        try {
          const user = await ipcGetCurrentUser(currentUser.id);
          if (user) {
            set((s) => { s.isAuthenticated = true; s.isHydrating = false; });
          } else {
            // User no longer exists in DB — clear stale session
            set((s) => {
              s.isAuthenticated = false;
              s.currentUser = null;
              s.isHydrating = false;
            });
          }
        } catch {
          // DB unavailable — fail safe (require re-login)
          set((s) => {
            s.isAuthenticated = false;
            s.currentUser = null;
            s.isHydrating = false;
          });
        }
      },

      loadUsers: async () => {
        try {
          const users = await ipcListUsers();
          set((s) => { s.users = users; });
        } catch {
          // Silent failure — keep existing users list
        }
      },

      clearError: () => {
        set((s) => { s.error = null; });
      },
    })),
    {
      name: 'auth-storage',
      // Only persist auth session data — not ephemeral UI state
      partialize: (state) => ({
        isAuthenticated: state.isAuthenticated,
        currentUser: state.currentUser,
      }),
    },
  ),
);
