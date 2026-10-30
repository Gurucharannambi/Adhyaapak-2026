import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { AuthResponse, LoginRequest, RegisterRequest, UserDto } from "@adhyaapak/shared";
import { ApiRequestError, api } from "../../services/api";

interface AuthState {
  user: UserDto | null;
  /** True until the first /auth/me check finishes, so routes do not flash the login page. */
  loading: boolean;
  login: (input: LoginRequest) => Promise<void>;
  register: (input: RegisterRequest) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

// The last signed-in user, kept only so a teacher who is already signed in can open saved lesson packs
// when the server cannot be reached. The server never trusts it and still checks every request.
const CACHED_USER = "adhyaapak.lastUser";
const readCached = (): UserDto | null => {
  try {
    const raw = localStorage.getItem(CACHED_USER);
    return raw ? (JSON.parse(raw) as UserDto) : null;
  } catch {
    return null;
  }
};
const writeCached = (u: UserDto | null) => {
  try {
    if (u) localStorage.setItem(CACHED_USER, JSON.stringify(u));
    else localStorage.removeItem(CACHED_USER);
  } catch {
    // storage blocked: offline sign-in memory is simply unavailable
  }
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserDto | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api<AuthResponse>("/auth/me")
      .then((r) => {
        if (cancelled) return;
        setUser(r.user);
        writeCached(r.user);
      })
      .catch((err) => {
        if (err instanceof ApiRequestError && err.code === "unauthenticated") return writeCached(null);
        // Server unreachable: keep working from this device as the last signed-in user.
        if (err instanceof ApiRequestError && (err.code === "network_error" || err.code === "offline")) {
          const cached = readCached();
          if (cached && !cancelled) setUser(cached);
          return;
        }
        console.warn("auth check failed", err);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (input: LoginRequest) => {
    const u = (await api<AuthResponse>("/auth/login", { method: "POST", body: input })).user;
    writeCached(u);
    setUser(u);
  }, []);
  const register = useCallback(async (input: RegisterRequest) => {
    const u = (await api<AuthResponse>("/auth/register", { method: "POST", body: input })).user;
    writeCached(u);
    setUser(u);
  }, []);
  const logout = useCallback(async () => {
    await api<void>("/auth/logout", { method: "POST" });
    writeCached(null);
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, loading, login, register, logout }), [user, loading, login, register, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
