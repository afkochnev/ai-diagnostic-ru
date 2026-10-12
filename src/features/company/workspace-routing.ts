/** Selection is explicit whenever a workspace contains more than one company. */
export function workspaceDestination(companyCount: number, accountCount: number) {
  if (companyCount > 1 || (companyCount === 0 && accountCount !== 1)) return "/ru/companies";
  return companyCount === 1 ? "/ru/dashboard" : "/ru/company-profile";
}

export function resolveCompanySelection<T extends { id: string }>(companies: readonly T[], requestedId?: string) {
  if (requestedId !== undefined) {
    const company = companies.find(({ id }) => id === requestedId);
    return company ? { kind: "selected" as const, company } : { kind: "inaccessible" as const };
  }
  if (companies.length > 1) return { kind: "ambiguous" as const };
  if (companies.length === 0) return { kind: "missing" as const };
  return { kind: "selected" as const, company: companies[0] };
}
