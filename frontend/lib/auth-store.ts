"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { create } from "zustand";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "http://localhost:8000";

export type User = {
  id: string;
  email: string;
  name: string;
};

export type Tier = "free" | "pro" | "enterprise";

export type TierUsage = {
  bots: number;
  max_bots: number;
  max_pages_per_bot: number;
  messages_this_month: number;
  monthly_messages: number;
};

export type MeUser = User & {
  api_key: string;
  tier: Tier;
  subscription_status: string;
  usage: TierUsage;
};

type AuthState = {
  user: User | null;
  me: MeUser | null;
  token: string | null;
  hydrated: boolean;
  isLoading: boolean;
  hydrate: () => Promise<void>;
  refreshMe: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  signup: (name: string, email: string, password: string) => Promise<void>;
  logout: () => void;
};

const TOKEN_KEY = "sitebot-token";
const USER_KEY = "sitebot-user";

export class AuthError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}

function readToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function writeToken(token: string | null) {
  if (typeof window === "undefined") return;
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  else window.localStorage.removeItem(TOKEN_KEY);
}

function readStoredUser(): User | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(USER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<User>;
    if (!parsed?.id || !parsed?.email) return null;
    return {
      id: parsed.id,
      email: parsed.email,
      name: parsed.name ?? parsed.email.split("@")[0] ?? "User",
    };
  } catch {
    return null;
  }
}

function writeStoredUser(user: User | null) {
  if (typeof window === "undefined") return;
  if (user) window.localStorage.setItem(USER_KEY, JSON.stringify(user));
  else window.localStorage.removeItem(USER_KEY);
}

async function authFetch<T>(
  path: string,
  init: RequestInit & { token?: string | null } = {},
): Promise<T> {
  const { token, ...rest } = init;
  const headers = new Headers(rest.headers);
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, { ...rest, headers });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Network error";
    throw new AuthError(0, msg);
  }
  if (!res.ok) {
    let message = `Request failed with status ${res.status}`;
    try {
      const body = (await res.json()) as { detail?: string };
      if (body.detail) message = body.detail;
    } catch {
      /* ignore */
    }
    throw new AuthError(res.status, message);
  }
  return (await res.json()) as T;
}

type AuthPayload = { token: string; user: User };

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  me: null,
  token: null,
  hydrated: false,
  isLoading: false,

  hydrate: async () => {
    const token = readToken();
    if (!token) {
      set({ user: null, me: null, token: null, hydrated: true });
      writeStoredUser(null);
      return;
    }
    const stored = readStoredUser();
    set({ user: stored, token, hydrated: false });
    try {
      const me = await authFetch<MeUser>("/auth/me", { token });
      const basic: User = { id: me.id, email: me.email, name: me.name };
      writeStoredUser(basic);
      set({ user: basic, me, token, hydrated: true });
    } catch (err) {
      if (err instanceof AuthError && err.status === 401) {
        writeToken(null);
        writeStoredUser(null);
        set({ user: null, me: null, token: null, hydrated: true });
      } else {
        set({ hydrated: true });
      }
    }
  },

  refreshMe: async () => {
    const token = get().token ?? readToken();
    if (!token) return;
    try {
      const me = await authFetch<MeUser>("/auth/me", { token });
      const basic: User = { id: me.id, email: me.email, name: me.name };
      writeStoredUser(basic);
      set({ me, user: basic });
    } catch {
      /* silent */
    }
  },

  login: async (email, password) => {
    set({ isLoading: true });
    try {
      const body = await authFetch<AuthPayload>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      writeToken(body.token);
      writeStoredUser(body.user);
      set({ user: body.user, token: body.token });
      // Fetch full profile (with tier + usage) in the background.
      void get().refreshMe();
    } finally {
      set({ isLoading: false });
    }
  },

  signup: async (name, email, password) => {
    set({ isLoading: true });
    try {
      const body = await authFetch<AuthPayload>("/auth/signup", {
        method: "POST",
        body: JSON.stringify({ name, email, password }),
      });
      writeToken(body.token);
      writeStoredUser(body.user);
      set({ user: body.user, token: body.token });
      void get().refreshMe();
    } finally {
      set({ isLoading: false });
    }
  },

  logout: () => {
    writeToken(null);
    writeStoredUser(null);
    set({ user: null, me: null, token: null });
  },
}));

/** Synchronous accessor for token — used outside React (e.g. fetch wrapper). */
export function getAuthToken(): string | null {
  return useAuthStore.getState().token ?? readToken();
}

export function clearAuth() {
  useAuthStore.getState().logout();
}

export function useAuth() {
  const user = useAuthStore((s) => s.user);
  const me = useAuthStore((s) => s.me);
  const token = useAuthStore((s) => s.token);
  const hydrated = useAuthStore((s) => s.hydrated);
  const isLoading = useAuthStore((s) => s.isLoading);
  const login = useAuthStore((s) => s.login);
  const signup = useAuthStore((s) => s.signup);
  const logout = useAuthStore((s) => s.logout);
  const refreshMe = useAuthStore((s) => s.refreshMe);
  const hydrate = useAuthStore((s) => s.hydrate);

  React.useEffect(() => {
    if (!hydrated) void hydrate();
  }, [hydrated, hydrate]);

  return {
    user,
    me,
    token,
    hydrated,
    isLoading,
    login,
    signup,
    logout,
    refreshMe,
  };
}

export function useRequireAuth() {
  const router = useRouter();
  const { user, hydrated } = useAuth();

  React.useEffect(() => {
    if (hydrated && !user) {
      router.replace("/login");
    }
  }, [hydrated, user, router]);

  return { user, hydrated };
}
