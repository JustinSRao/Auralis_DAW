import { create } from "zustand";
import { persist } from "zustand/middleware";

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
    (set) => ({
      isAuthenticated: false,
      currentUser: null,
      login: (user) => set({ isAuthenticated: true, currentUser: user }),
      logout: () => set({ isAuthenticated: false, currentUser: null }),
    }),
    { name: "auth-storage" }
  )
);
