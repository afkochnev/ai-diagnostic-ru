export type SignupResult = { user?: unknown | null } | null | undefined;

/** Values consumed by private.provision_identity must remain JSON booleans. */
export function buildSignupMetadata(input: {
  full_name: string;
  data_processing_consent: boolean;
  marketing_consent: boolean;
  versions: Record<string, string>;
}) {
  return {
    full_name: input.full_name,
    data_processing_consent: input.data_processing_consent === true,
    marketing_consent: input.marketing_consent === true,
    ...input.versions,
  } as Record<string, unknown> & { data_processing_consent: boolean; marketing_consent: boolean; full_name: string };
}

export function hasCreatedAuthUser(data: SignupResult) {
  return Boolean(data?.user && Array.isArray((data.user as { identities?: unknown }).identities) && (data.user as { identities: Array<{ provider?: unknown }> }).identities.some((identity) => identity?.provider === "email"));
}

export function signupIdentitySummary(data: SignupResult) {
  const identities = Array.isArray((data?.user as { identities?: unknown } | null)?.identities) ? (data?.user as { identities: Array<{ provider?: unknown }> }).identities : [];
  return {
    identitiesCount: identities.length,
    hasEmailIdentity: identities.some((identity) => identity?.provider === "email"),
  };
}
