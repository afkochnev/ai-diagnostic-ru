"use server";

import { redirect } from "next/navigation";
import { requireIdentity } from "@/server/auth/session";
import { createDiagnostic, DiagnosticError } from "./service";

export async function startDiagnosticAction() {
  const identity = await requireIdentity();
  try {
    const result = await createDiagnostic(identity.user.id);
    redirect(`/ru/diagnostics/${result.id}`);
  } catch (error) {
    if (error instanceof DiagnosticError) redirect("/ru/company-profile");
    throw error;
  }
}
