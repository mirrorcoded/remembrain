/** True when the stored refresh token is invalid / revoked — cookies should be cleared. */
export function shouldClearSupabaseSession(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const e = error as { code?: string; message?: string };
  if (e.code === "refresh_token_not_found") {
    return true;
  }
  if (typeof e.message === "string") {
    return /invalid refresh token|refresh token not found/i.test(e.message);
  }
  return false;
}
