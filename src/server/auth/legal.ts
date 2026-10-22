import "server-only";
import { createAuthClient } from "@/server/supabase/server";
import { consentLinks, type PublishedPrivacyDocument } from "./legal-contract";

function legalUrl(value: string | undefined, fallback: string) {
  if (!value) return fallback;
  if (value.startsWith("/") && !value.startsWith("//") && !value.includes("\\")) return value;
  if (new URL(value).protocol !== "https:") throw new Error("Legal URL must be local or HTTPS");
  return value;
}

export async function registrationPolicy() {
  const client = await createAuthClient();
  const { data, error } = await client.from("consent_documents").select("kind, version, is_temporary");
  if (error || !data) throw new Error("Registration policy unavailable");
  let documents: PublishedPrivacyDocument[] = [];
  if (data.some(p => !p.is_temporary)) {
    const published = await client.from("privacy_legal_documents").select("version,kind,policy_version");
    if (published.error || !published.data) throw new Error("Registration policy unavailable");
    documents = published.data;
  }
  const policy = consentLinks(data, documents);
  // Legacy configuration is honored only for temporary documents. Final links always identify exact versions.
  if (policy.temporary) {
    if (data.find(p => p.kind === "data_processing")?.is_temporary) policy.dataUrl = legalUrl(process.env.DATA_PROCESSING_POLICY_URL, policy.dataUrl);
    if (data.find(p => p.kind === "marketing")?.is_temporary) policy.marketingUrl = legalUrl(process.env.MARKETING_POLICY_URL, policy.marketingUrl);
  }
  return policy;
}

export async function publishedPrivacyDocument(version: string) {
  if (!/^[a-z0-9-]{1,100}$/.test(version)) return null;
  const client = await createAuthClient();
  const {data, error} = await client.from("privacy_legal_documents").select("version,kind,body,body_sha256,policy_version,published_at").eq("version", version).maybeSingle();
  if (error) throw new Error("Legal document unavailable");
  return data;
}
