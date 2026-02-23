import { create } from "zustand";
import { persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

interface User {
  id: string;
  username: string;
}

interface AuthState {
  isAuthenticated: boolean;
  currentUser: User | null;
  login: (user: User) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    immer((set) => ({
      isAuthenticated: false,
      currentUser: null,
      login: (user) =>
        set((state) => {
          state.isAuthenticated = true;
          state.currentUser = user;
        }),
      logout: () =>
        set((state) => {
          state.isAuthenticated = false;
          state.currentUser = null;
        }),
    })),
    { name: "auth-storage" }
  )
);
