import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { authConfig } from "@/server/supabase/config";
import { createAuthClient } from "@/server/supabase/server";
import { createAdminClient } from "@/server-runtime/supabase/admin";
import { teamFoundationEnabled } from "@/server/team/capabilities";
import type { SupabaseClient } from "@supabase/supabase-js";
import { safeTeamResponseReturnTo } from "./mfa-return";

const cookieName = "team-login-return";
const lifetime = 30 * 60 * 1000;
const encryptionKey = () => createHash("sha256").update("team-login-return/v1/" + authConfig().AUTH_FLOW_SECRET).digest();
const safePath = (value: unknown) => value === "/ru/team/join" ? value : safeTeamResponseReturnTo(value);

export async function setTeamLoginReturn(email: string, path: string | null) {
  const jar = await cookies();
  const options = { httpOnly: true, secure: authConfig().secure, sameSite: "lax" as const, path: "/" };
  if (!safePath(path)) {
    jar.set(cookieName, "", { ...options, maxAge: 0 });
    return;
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const payload = Buffer.concat([
    cipher.update(JSON.stringify({ email: email.toLowerCase(), path, expires: Date.now() + lifetime }), "utf8"),
    cipher.final(),
  ]);
  jar.set(cookieName, Buffer.concat([iv, cipher.getAuthTag(), payload]).toString("base64url"), { ...options, maxAge: lifetime / 1000 });
}

function openTeamLoginReturn(value: string | undefined): { email: string; path: string } | null {
  if (!value || value.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const bytes = Buffer.from(value, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28));
    const data = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8"));
    const path = safePath(data.path);
    return typeof data.email === "string" && path && Number.isFinite(data.expires) &&
      data.expires > Date.now() && data.expires <= Date.now() + lifetime ? { email: data.email, path } : null;
  } catch {
    return null;
  }
}

/** Recovery may retain the destination without consuming or authenticating the pending login. */
export async function peekTeamLoginReturn(): Promise<string | null> {
  return openTeamLoginReturn((await cookies()).get(cookieName)?.value)?.path ?? null;
}

export async function consumeTeamLoginReturn(email: string | undefined): Promise<string | null> {
  const jar = await cookies();
  const value = jar.get(cookieName)?.value;
  if (!value) return null;
  jar.set(cookieName, "", { httpOnly: true, secure: authConfig().secure, sameSite: "lax", path: "/", maxAge: 0 });
  if (!email) return null;
  const context = openTeamLoginReturn(value);
  return context?.email === email.toLowerCase() ? context.path : null;
}

export async function authorizedTeamReturn(path: string, client: unknown): Promise<string | null> {
  if (path === "/ru/team/join") return path;
  const safe = safeTeamResponseReturnTo(path);
  if (!safe) return null;
  const participantId = safe.slice(safe.lastIndexOf("/") + 1);
  const authClient = client as SupabaseClient;
  const { error } = await authClient.rpc("read_team_response", { p_participant_id: participantId });
  if (!error) return path;
  // An administrator with a configured second factor must step up before the
  // participant RPC can verify access. The destination repeats both checks.
  if (authClient.auth?.mfa) {
    const { data: { user } } = await authClient.auth.getUser();
    if (!user?.email_confirmed_at) return null;
    const { data: role } = await authClient.from("user_roles").select("role").eq("user_id", user.id).single();
    const { data: assurance } = await authClient.auth.mfa.getAuthenticatorAssuranceLevel();
    if (role?.role === "administrator" && assurance?.nextLevel === "aal2" && assurance.currentLevel !== "aal2") {
      return `/ru/mfa?next=${encodeURIComponent(path)}`;
    }
  }
  return null;
}

/** Metadata narrows candidates; the participant RPC independently verifies the current actor. */
export async function activeParticipantDestination(email: string | undefined): Promise<string | null> {
  if (!email || !teamFoundationEnabled()) return null;
  const admin = createAdminClient() as unknown as SupabaseClient;
  const { data, error } = await admin.from("team_participants").select("id,team_diagnostics!inner(status)")
    .eq("email", email.toLowerCase()).is("revoked_at", null).in("status", ["invited", "started"])
    .eq("team_diagnostics.status", "open").order("invited_at", { ascending: false }).limit(10);
  if (error) throw new Error("team_resume_unavailable");
  if (!data?.length) return null;
  const client = await createAuthClient();
  for (const participant of data) {
    const path = safeTeamResponseReturnTo(`/ru/team/responses/${participant.id}`);
    if (path) {
      const destination = await authorizedTeamReturn(path, client);
      if (destination) return destination;
    }
  }
  return null;
}
