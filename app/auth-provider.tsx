"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { clearMainSession } from "@/lib/workspace/main-client";
import { isSupabaseConfigured } from "@/lib/supabase";
import { seedDefaultData } from "@/lib/money/queries";

interface AuthCtx {
  authenticated: boolean;
  username: string | null;
  credentialsMode: boolean;
  signInCredentials: (username: string, password: string) => Promise<void>;
  loading: boolean;
  configured: boolean;
  pinExists: boolean | null;
  signIn: (pin: string) => Promise<void>;
  setPin: (pin: string) => Promise<void>;
  signOut: () => void;
}

const AuthContext = createContext<AuthCtx>({
  authenticated: false,
  username: null,
  credentialsMode: false,
  signInCredentials: async () => {},
  loading: true,
  configured: false,
  pinExists: null,
  signIn: async () => {},
  setPin: async () => {},
  signOut: () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

export function MoneyAuthProvider({
  children,
  demoMode = false,
}: {
  children: ReactNode;
  demoMode?: boolean;
}) {
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const credentialsMode = !demoMode && process.env.NEXT_PUBLIC_AUTHENTICATED_APP === "true";
  const [username, setUsername] = useState<string | null>(null);
  const configured = credentialsMode || demoMode || isSupabaseConfigured();
  const [pinExists, setPinExists] = useState<boolean | null>(null);

  useEffect(() => {
    if (demoMode) {
      setAuthenticated(true);
      setPinExists(true);
      setLoading(false);
      return;
    }

    if (!configured) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function checkSession() {
      try {
        const sessionRes = await fetch(
          credentialsMode ? "/api/workspace/auth/session" : "/api/session",
          { cache: "no-store" }
        );
        const sessionData = await sessionRes.json();

        if (!cancelled) {
          if (credentialsMode && !sessionData.user) clearMainSession();
          setAuthenticated(
            credentialsMode ? Boolean(sessionData.user) : sessionData.authenticated === true
          );
          setUsername(sessionData.user?.username ?? null);
          setPinExists(sessionData.pinExists === true);
        }
      } catch {
        if (!cancelled) {
          setAuthenticated(false);
          setPinExists(false);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    checkSession();
    const interval = credentialsMode ? window.setInterval(checkSession, 30000) : undefined;
    const recheck = () => {
      if (document.visibilityState === "visible") void checkSession();
    };
    if (credentialsMode) document.addEventListener("visibilitychange", recheck);
    return () => {
      cancelled = true;
      if (interval) window.clearInterval(interval);
      document.removeEventListener("visibilitychange", recheck);
    };
  }, [configured, demoMode, credentialsMode]);

  const signInCredentials = async (username: string, password: string) => {
    const res = await fetch("/api/workspace/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Sign in failed");
    const session = await fetch("/api/workspace/auth/session", { cache: "no-store" });
    const result = await session.json();
    if (!session.ok || !result.user) throw new Error("Sign in required");
    clearMainSession();
    setUsername(result.user.username);
    setAuthenticated(true);
  };

  const signIn = async (pin: string) => {
    if (credentialsMode) throw new Error("Use your username and password");
    if (demoMode) {
      setAuthenticated(true);
      return;
    }

    const res = await fetch("/api/verify-pin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin }),
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || "Invalid PIN");
    }

    setAuthenticated(true);

    if (configured) {
      seedDefaultData().catch(console.error);
    }
  };

  const setPin = async (pin: string) => {
    if (credentialsMode) throw new Error("Accounts are provisioned by the local administrator");
    if (demoMode) {
      setAuthenticated(true);
      setPinExists(true);
      return;
    }

    const res = await fetch("/api/set-pin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin }),
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || "Failed to set PIN");
    }

    setPinExists(true);
    setAuthenticated(true);

    if (configured) {
      seedDefaultData().catch(console.error);
    }
  };

  const signOut = async () => {
    if (demoMode) return;
    if (credentialsMode) {
      const response = await fetch("/api/workspace/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("Sign out failed. Please try again.");
      setAuthenticated(false);
      clearMainSession();
      setUsername(null);
      window.location.replace("/");
      return;
    }
    await fetch("/api/session", { method: "DELETE" }).catch(() => {});
    setAuthenticated(false);
  };

  return (
    <AuthContext.Provider
      value={{
        username,
        credentialsMode,
        signInCredentials,
        authenticated,
        loading,
        configured,
        pinExists,
        signIn,
        setPin,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
