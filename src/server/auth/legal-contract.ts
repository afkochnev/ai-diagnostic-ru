export type ConsentPointer = {kind: string; version: string; is_temporary: boolean};
export type PublishedPrivacyDocument = {version: string; kind: string; policy_version: string | null};

// A final pointer without its published exact document fails closed.
export function consentLinks(pointers: ConsentPointer[], documents: PublishedPrivacyDocument[]) {
  if (pointers.length !== 2 || !["data_processing", "marketing"].every(kind => pointers.filter(p => p.kind === kind).length === 1)) throw new Error("Registration policy unavailable");
  const versions = Object.fromEntries(pointers.map(p => [p.kind, p.version]));
  const path = (version: string) => `/ru/legal/privacy/${encodeURIComponent(version)}`;
  const urls: Record<string, string> = {};
  let policyUrl = "/ru/legal/data-processing";
  for (const p of pointers) {
    if (p.is_temporary) { urls[p.kind] = `/ru/legal/${p.kind === "marketing" ? "marketing" : "data-processing"}`; continue; }
    const doc = documents.find(d => d.version === p.version && d.kind === p.kind);
    const policy = documents.find(d => d.version === doc?.policy_version && d.kind === "policy");
    if (!doc || !policy) throw new Error("Registration policy unavailable");
    urls[p.kind] = path(doc.version);
    if (p.kind === "data_processing") policyUrl = path(policy.version);
  }
  return {versions, temporary: pointers.some(p => p.is_temporary), dataUrl: urls.data_processing, marketingUrl: urls.marketing, policyUrl};
}
