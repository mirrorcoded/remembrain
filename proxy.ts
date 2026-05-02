import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { shouldClearSupabaseSession } from "@/lib/supabase/auth-errors";

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return supabaseResponse;
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options),
        );
        Object.entries(headers).forEach(([key, value]) =>
          supabaseResponse.headers.set(key, value),
        );
      },
    },
  });

  try {
    const { error } = await supabase.auth.getUser();
    if (error && shouldClearSupabaseSession(error)) {
      await supabase.auth.signOut({ scope: "local" });
    }
  } catch (error) {
    if (shouldClearSupabaseSession(error)) {
      try {
        await supabase.auth.signOut({ scope: "local" });
      } catch {
        // ignore — still return a normal response so the page can render (login UI)
      }
    } else {
      console.error("[proxy] supabase.auth.getUser failed:", error);
    }
  }

  return supabaseResponse;
}

/** Next resolves either the named `proxy` handler or `default`. */
export default proxy;

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
