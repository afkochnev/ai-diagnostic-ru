import {z} from "zod";

/** Return context only; the destination still verifies Account and Company access. */
export function safeMfaReturnTo(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 512 || !value.startsWith("/") || value.startsWith("//") || /[\\\s]/.test(value)) return null;
  const url = new URL(value, "https://mfa.internal");
  if (url.origin !== "https://mfa.internal" || url.pathname !== "/ru/account/plan" || url.hash) return null;
  if ([...url.searchParams.keys()].some(key => !["account", "company"].includes(key))) return null;
  const query = new URLSearchParams();
  for (const key of ["account", "company"]) {
    const values = url.searchParams.getAll(key);
    if (values.length > 1 || (values.length === 1 && !z.uuid().safeParse(values[0]).success)) return null;
    if (values.length) query.set(key, values[0]);
  }
  return url.pathname + (query.size ? `?${query}` : "");
}

export function accountPlanMfaReturnTo(account: unknown, company: unknown): string {
  const query = new URLSearchParams();
  if (typeof account === "string" && account) query.set("account", account);
  if (typeof company === "string" && company) query.set("company", company);
  return safeMfaReturnTo(`/ru/account/plan${query.size ? `?${query}` : ""}`) ?? "/ru/account/plan";
}
