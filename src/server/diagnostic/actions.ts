"use server";

import { redirect } from "next/navigation";
import { requireIdentity } from "@/server/auth/session";
import { createDiagnostic, DiagnosticError } from "./service";
import {formLocale} from "@/server/locale";

export async function startDiagnosticAction(form?: FormData) {
  const identity = await requireIdentity();
  const locale = formLocale(form);
  try {
    const companyId = String(form?.get("company_id") ?? "") || undefined;
    const result = await createDiagnostic(identity.user.id, companyId, locale);
    if (result.locale !== locale) redirect(`/${locale}/companies/${result.company_id}/diagnostics?existingLanguage=${result.locale}&existingDiagnostic=${result.id}`);
    redirect(`/${locale}/diagnostics/${result.id}`);
  } catch (error) {
    if (error instanceof DiagnosticError && error.code === "company_missing") redirect(`/${locale}/company-profile`);
    if (error instanceof DiagnosticError && error.code === "selection_required") redirect(`/${locale}/companies`);
    throw error;
  }
}
