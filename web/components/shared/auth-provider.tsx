"use client";

import * as React from "react";

import type { UserRole } from "@/lib/types";

interface AuthContextValue {
  role: UserRole;
  hydrated: boolean;
  switchRole: (role: UserRole) => void;
}

const AuthContext = React.createContext<AuthContextValue | null>(null);

const STORAGE_KEY = "flowfit-role";
const DEFAULT_ROLE: UserRole = "admin";

function isUserRole(value: string | null): value is UserRole {
  return value === "admin";
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [role, setRole] = React.useState<UserRole>(DEFAULT_ROLE);
  const [hydrated, setHydrated] = React.useState(false);

  React.useEffect(() => {
    const savedRole = window.localStorage.getItem(STORAGE_KEY);
    const nextRole = isUserRole(savedRole) ? savedRole : DEFAULT_ROLE;
    setRole(nextRole);
    window.localStorage.setItem(STORAGE_KEY, nextRole);
    setHydrated(true);
  }, []);

  const switchRole = React.useCallback((nextRole: UserRole) => {
    const safeRole = isUserRole(nextRole) ? nextRole : DEFAULT_ROLE;
    setRole(safeRole);
    window.localStorage.setItem(STORAGE_KEY, safeRole);
  }, []);

  return (
    <AuthContext.Provider value={{ role, hydrated, switchRole }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuthRole() {
  const context = React.useContext(AuthContext);
  if (!context) {
    throw new Error("useAuthRole must be used within AuthProvider");
  }

  return context;
}
