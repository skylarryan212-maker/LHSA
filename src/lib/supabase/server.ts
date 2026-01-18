"use server";

import { createServerClient } from "./ssr-shim";
import { SUPABASE_AUTH_STORAGE_KEY, SUPABASE_TOKEN_COOKIE } from "@/lib/supabase/constants";
import type { Database } from "./types";

export async function getAuthTokenServer() {
  try {
    if (typeof document === "undefined") {
      return null;
    }
    const match = document.cookie
      .split(";")
      .map((cookie) => cookie.trim())
      .find((cookie) => cookie.startsWith(`${SUPABASE_TOKEN_COOKIE}=`));
    return match ? decodeURIComponent(match.split("=")[1] ?? "") : null;
  } catch {
    return null;
  }
}

export async function supabaseServer() {
  // Turbopack RSC / Next versions may make `cookies()` async. Call it and
  // await if it returns a Promise; otherwise use the value directly. If
  // cookies are unavailable, degrade to stateless behavior.
  const cookieStore = {
    get(name: string) {
      if (typeof document === "undefined") {
        return undefined;
      }
      const match = document.cookie
        .split(";")
        .map((cookie) => cookie.trim())
        .find((cookie) => cookie.startsWith(`${name}=`));
      if (!match) {
        return undefined;
      }
      return { value: decodeURIComponent(match.split("=")[1] ?? "") };
    },
    set(_name: string, _value: string, _options?: any) {
      // noop in webview
    },
  } as const;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Supabase environment variables are not set");
  }

  return createServerClient<Database>(supabaseUrl, supabaseAnonKey, {
    auth: { storageKey: SUPABASE_AUTH_STORAGE_KEY },
    cookies: {
      get(name: string) {
        if (!cookieStore || typeof (cookieStore as any).get !== "function") {
          return undefined;
        }
        try {
          return (cookieStore as any).get(name)?.value;
        } catch {
          return undefined;
        }
      },
      set(name: string, value: string, options: any) {
        if (!cookieStore || typeof (cookieStore as any).set !== "function") {
          return;
        }
        try {
          (cookieStore as any).set({ name, value, ...options });
        } catch {
          // noop if cookies are read-only in this context
        }
      },
      remove(name: string, options: any) {
        if (!cookieStore || typeof (cookieStore as any).set !== "function") {
          return;
        }
        try {
          (cookieStore as any).set({ name, value: "", ...options });
        } catch {
          // noop if cookies are read-only in this context
        }
      },
    },
  });
}

export async function supabaseServerAdmin() {
  // Admin client with service role - bypasses RLS
  // Use ONLY for server-side operations that need elevated permissions
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error("Supabase admin environment variables are not set");
  }

  return createServerClient<Database>(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
