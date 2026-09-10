"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createAuthClient } from "@/server/supabase/server";
import { authConfig } from "@/server/supabase/config";
import { clearRecovery, hasRecovery, setRecovery } from "./recovery";
import { emailSchema, loginSchema, passwordSchema, registrationSchema, type AuthState } from "@/validation/auth";
import { getMessages } from "@/i18n/messages";

const text = getMessages("ru").auth;
const value = (form: FormData, name: string) => String(form.get(name) ?? "");

async function actionClient() {
  const origin = (await headers()).get("origin");
  if (origin !== authConfig().APP_URL) throw new Error("Invalid action origin");
  return createAuthClient();
}
function failure(error: { status?: number; code?: string } | null): AuthState {
  return { error: error?.status === 429 ? text.rateLimit : text.technical };
}

export async function registerAction(_: AuthState, form: FormData): Promise<AuthState> {
  const parsed = registrationSchema.safeParse({
    full_name: value(form, "full_name"), email: value(form, "email").trim(), password: value(form, "password"),
    confirm_password: value(form, "confirm_password"),
    data_processing_consent: form.get("data_processing_consent") === "on", marketing_consent: form.get("marketing_consent") === "on",
  });
  if (!parsed.success) return { error: parsed.error.issues.some((issue) => issue.path[0] === "confirm_password") ? text.passwordMismatch : text.required };
  const client = await actionClient();
  const { data: documents, error: policyError } = await client.from("consent_documents").select("kind, version");
  if (policyError || documents?.length !== 2) return { error: text.technical };
  const versions = Object.fromEntries(documents.map((doc) => [`${doc.kind}_version`, doc.version]));
  for (const [key, version] of Object.entries(versions)) {
    if (value(form, key) !== version) return { error: text.required };
  }
  const { email, password, ...metadata } = parsed.data;
  const { error } = await client.auth.signUp({ email, password, options: {
    emailRedirectTo: `${authConfig().APP_URL}/auth/confirm`, data: { ...metadata, ...versions },
  } });
  if (error) return failure(error);
  // Supabase may deliberately return an obfuscated user for duplicate emails.
  // Always show the same confirmation state, without an enumeration endpoint.
  await clearRecovery();
  redirect("/ru/verify-email");
}

export async function loginAction(_: AuthState, form: FormData): Promise<AuthState> {
  const parsed = loginSchema.safeParse({ email: value(form, "email").trim(), password: value(form, "password") });
  if (!parsed.success) return { error: text.emptyLogin };
  const client = await actionClient();
  const { error } = await client.auth.signInWithPassword(parsed.data);
  if (error) return { error: error.status === 429 ? text.rateLimit : error.code === "email_not_confirmed" ? text.verifyRequired : text.badLogin };
  await clearRecovery();
  revalidatePath("/", "layout");
  redirect("/ru/account");
}

export async function logoutAction() {
  const client = await actionClient();
  const { error } = await client.auth.signOut({ scope: "global" });
  if (error) throw new Error("Sign out failed");
  await clearRecovery();
  revalidatePath("/", "layout");
  redirect("/ru/login");
}

export async function forgotAction(_: AuthState, form: FormData): Promise<AuthState> {
  const parsed = emailSchema.safeParse(value(form, "email").trim());
  if (!parsed.success) return { error: text.badEmail };
  const client = await actionClient();
  const { error } = await client.auth.resetPasswordForEmail(parsed.data, { redirectTo: `${authConfig().APP_URL}/auth/confirm` });
  if (error) return failure(error);
  return { success: text.sent };
}

export async function resendAction(_: AuthState, form: FormData): Promise<AuthState> {
  const parsed = emailSchema.safeParse(value(form, "email").trim());
  if (!parsed.success) return { error: text.badEmail };
  const client = await actionClient();
  const { error } = await client.auth.resend({ type: "signup", email: parsed.data, options: { emailRedirectTo: `${authConfig().APP_URL}/auth/confirm` } });
  if (error?.status === 429) return { error: text.rateLimit };
  if (error && error.status && error.status >= 500) return failure(error);
  return { success: text.sent };
}

export async function confirmAction(_: AuthState, form: FormData): Promise<AuthState> {
  const type = value(form, "type");
  const token_hash = value(form, "token_hash");
  if (!["signup", "recovery"].includes(type) || !/^[A-Za-z0-9_-]{32,256}$/.test(token_hash)) return { error: text.invalidLink };
  const client = await actionClient();
  const { data, error } = await client.auth.verifyOtp({ token_hash, type: type as "signup" | "recovery" });
  if (error || !data.user) return { error: text.invalidLink };
  if (type === "recovery") {
    const { data: claims } = await client.auth.getClaims();
    const sessionId = claims?.claims.session_id;
    if (typeof sessionId !== "string") return { error: text.invalidLink };
    await setRecovery(data.user.id, sessionId);
    redirect("/ru/reset-password");
  }
  await clearRecovery();
  revalidatePath("/", "layout");
  redirect("/ru/company-profile");
}

export async function resetAction(_: AuthState, form: FormData): Promise<AuthState> {
  const parsed = passwordSchema.safeParse(value(form, "password"));
  if (!parsed.success) return { error: text.badPassword };
  const client = await actionClient();
  const { data: { user } } = await client.auth.getUser();
  const { data: claims } = await client.auth.getClaims();
  const sessionId = claims?.claims.session_id;
  if (!user || typeof sessionId !== "string" || !await hasRecovery(user.id, sessionId)) return { error: text.invalidLink };
  const { error } = await client.auth.updateUser({ password: parsed.data });
  if (error) return failure(error);
  await clearRecovery();
  await client.auth.signOut({ scope: "global" });
  revalidatePath("/", "layout");
  redirect("/ru/login?password=updated");
}

export async function enrollMfaAction(): Promise<AuthState> {
  const client = await actionClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user?.email_confirmed_at) return { error: text.sessionExpired };
  const { data: role } = await client.from("user_roles").select("role").eq("user_id", user.id).single();
  if (role?.role !== "administrator") return { error: text.deniedText };
  const { data: factors } = await client.auth.mfa.listFactors();
  if (factors?.totp.some((factor) => factor.status === "verified")) return { error: text.mfaText };
  // Remove only the user's own unverified TOTP enrollments when restarting setup.
  for (const factor of factors?.all ?? []) {
    if (factor.factor_type === "totp" && factor.status === "unverified") await client.auth.mfa.unenroll({ factorId: factor.id });
  }
  const { data, error } = await client.auth.mfa.enroll({ factorType: "totp", friendlyName: "Administrator" });
  if (error) return failure(error);
  return { factorId: data.id, secret: data.totp.secret };
}

export async function verifyMfaAction(_: AuthState, form: FormData): Promise<AuthState> {
  const client = await actionClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user?.email_confirmed_at) return { error: text.sessionExpired };
  const { data: role } = await client.from("user_roles").select("role").eq("user_id", user.id).single();
  if (role?.role !== "administrator") return { error: text.deniedText };
  const factorId = value(form, "factor_id");
  const code = value(form, "code");
  if (!/^[0-9]{6}$/.test(code)) return { error: text.mfaBad };
  const { data: factors } = await client.auth.mfa.listFactors();
  if (!factors?.all.some((factor) => factor.id === factorId && factor.factor_type === "totp")) return { error: text.mfaBad };
  const { error } = await client.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) return { error: text.mfaBad };
  revalidatePath("/", "layout");
  redirect("/ru/company-profile");
}
