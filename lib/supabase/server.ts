import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import { shouldClearSupabaseSession } from "@/lib/supabase/auth-errors";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export async function createSupabaseServerClient(): Promise<SupabaseClient> {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Missing Supabase environment variables. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }

  const cookieStore = await cookies();

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet, headers) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
          void headers;
        } catch {
          // Cookie writes can fail outside mutable contexts; root proxy refreshes sessions.
        }
      },
    },
  });
}

export async function getAuthenticatedSupabase(): Promise<
  { supabase: SupabaseClient; user: User } | { supabase: null; user: null }
> {
  const supabase = await createSupabaseServerClient();
  try {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();
    if (error) {
      if (shouldClearSupabaseSession(error)) {
        try {
          await supabase.auth.signOut({ scope: "local" });
        } catch {
          // ignore
        }
      }
      return { supabase: null, user: null };
    }
    if (!user) {
      return { supabase: null, user: null };
    }
    return { supabase, user };
  } catch (error) {
    if (shouldClearSupabaseSession(error)) {
      try {
        await supabase.auth.signOut({ scope: "local" });
      } catch {
        // ignore
      }
    }
    return { supabase: null, user: null };
  }
}
