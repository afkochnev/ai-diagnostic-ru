export type SupabaseErrorInfo = { code?: string; message?: string };

export function isTransientSupabaseError(status: number | undefined, error?: SupabaseErrorInfo | null) {
  if (status === 401 || status === 403) return false;
  const code = error?.code?.toUpperCase() ?? "";
  if (/^(?:08[A-Z0-9]{3}|53300|57014|57P0[123]|PGRST00[0123])$/.test(code)) return true;
  // A known database or PostgREST error takes precedence over the generic HTTP status.
  if (/^(?:[A-Z0-9]{5}|PGRST\d{3})$/.test(code)) return false;
  if (status !== undefined) return status === 0 || status === 408 || status === 429 || status >= 500;
  return /^(?:Internal server error\.?|(?:TypeError: )?(?:fetch failed|Failed to fetch))$/i.test(error?.message?.trim() ?? "");
}
