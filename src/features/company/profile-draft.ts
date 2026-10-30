export const profileFields = ["name", "industry_key", "country", "products", "customer_segments", "sales_channels", "employee_count", "annual_revenue_key", "company_age_years", "management_levels", "key_problems", "main_goals"] as const;
const draftLifetimeMs = 7 * 24 * 60 * 60 * 1000;

export function profileDraftKey(userId: string, accountId: string, companyId?: string) {
  return `company-profile:v1:${userId}:${accountId}:${companyId ?? "new"}`;
}

/** A changed server revision always wins over an older browser draft. */
export function readProfileDraft(raw: string | null, revision: string, now = Date.now()): Record<string, string> | null {
  if (!raw) return null;
  try {
    const draft = JSON.parse(raw) as { revision?: unknown; savedAt?: unknown; values?: unknown };
    if (draft.revision !== revision || typeof draft.savedAt !== "number" || draft.savedAt > now || now - draft.savedAt > draftLifetimeMs || !draft.values || typeof draft.values !== "object") return null;
    const values = draft.values as Record<string, unknown>;
    return Object.fromEntries(profileFields.flatMap((field) => typeof values[field] === "string" && values[field].length <= 5000 ? [[field, values[field]]] : [])) as Record<string, string>;
  } catch { return null; }
}

export function encodeProfileDraft(values: Record<string, string>, revision: string, now = Date.now()) {
  return JSON.stringify({ revision, savedAt: now, values: Object.fromEntries(profileFields.map((field) => [field, values[field] ?? ""])) });
}
