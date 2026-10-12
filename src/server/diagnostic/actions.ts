"use server";

import { redirect } from "next/navigation";
import { requireIdentity } from "@/server/auth/session";
import { createDiagnostic, DiagnosticError } from "./service";

export async function startDiagnosticAction(form?: FormData) {
  const identity = await requireIdentity();
  try {
    const companyId = String(form?.get("company_id") ?? "") || undefined;
    const result = await createDiagnostic(identity.user.id, companyId);
    redirect(`/ru/diagnostics/${result.id}`);
  } catch (error) {
    if (error instanceof DiagnosticError && error.code === "company_missing") redirect("/ru/company-profile");
    if (error instanceof DiagnosticError && error.code === "selection_required") redirect("/ru/companies");
    throw error;
  }
}
