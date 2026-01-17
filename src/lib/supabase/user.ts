import { supabaseServer, getAuthTokenServer } from "@/lib/supabase/server";
import type { UserIdentity } from "@/components/user-identity-provider";
import { withCache } from "@/lib/server-cache";
import { SUPABASE_TOKEN_COOKIE } from "./constants";

export async function getCurrentUserIdServer() {
  const token = await getAuthTokenServer();
  if (token) {
    return withCache(`userId:${token}`, 30000, async () => {
      const supabase = await supabaseServer();
      const { data, error } = await supabase.auth.getUser();

      if (error && error.message !== "Auth session missing!") {
        throw new Error(`Failed to get current user: ${error.message}`);
      }

      return data?.user?.id ?? null;
    });
  }

  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.getUser();

  if (error && error.message !== "Auth session missing!") {
    throw new Error(`Failed to get current user: ${error.message}`);
  }

  return data?.user?.id ?? null;
}

export async function requireUserIdServer() {
  const userId = await getCurrentUserIdServer();
  if (!userId) {
    throw new Error("Not authenticated");
  }
  return userId;
}

export async function getCurrentUserIdClient() {
  const { default: supabaseClient } = await import("@/lib/supabase/browser-client");
  const { data, error } = await supabaseClient.auth.getUser();
  if (error && error.message !== "Auth session missing!") {
    throw new Error(`Failed to get current user (client): ${error.message}`);
  }
  return data?.user?.id ?? null;
}

export async function getCurrentUserIdentity(): Promise<UserIdentity> {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  const user = data?.user;

  const fullName =
    (user?.user_metadata as any)?.full_name ||
    (user?.user_metadata as any)?.name ||
    null;
  const email = user?.email ?? null;
  const avatarUrl =
    (user?.user_metadata as any)?.avatar_url ||
    (user?.user_metadata as any)?.picture ||
    (user?.user_metadata as any)?.image_url ||
    null;
  const tokenAuth = Boolean((user?.user_metadata as any)?.token_auth);

  if (!user?.id) {
    return {
      userId: null,
      fullName: null,
      email: null,
      avatarUrl: null,
      isGuest: true,
      tokenAuth: false,
    };
  }

  return {
    userId: user.id,
    fullName,
    email,
    avatarUrl,
    isGuest: false,
    tokenAuth,
  };
}
