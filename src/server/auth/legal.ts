import "server-only";
import { createAuthClient } from "@/server/supabase/server";

function legalUrl(value: string | undefined, fallback: string) {
  if (!value) return fallback;
  if (value.startsWith("/") && !value.startsWith("//") && !value.includes("\\")) return value;
  if (new URL(value).protocol !== "https:") throw new Error("Legal URL must be local or HTTPS");
  return value;
}

export async function registrationPolicy() {
  const client = await createAuthClient();
  const { data, error } = await client.from("consent_documents").select("kind, version, is_temporary");
  if (error || data?.length !== 2) throw new Error("Registration policy unavailable");
  return {
    versions: Object.fromEntries(data.map((row) => [row.kind, row.version])),
    temporary: data.some((row) => row.is_temporary),
    dataUrl: legalUrl(process.env.DATA_PROCESSING_POLICY_URL, "/ru/legal/data-processing"),
    marketingUrl: legalUrl(process.env.MARKETING_POLICY_URL, "/ru/legal/marketing"),
  };
}
