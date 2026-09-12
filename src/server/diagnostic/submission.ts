import "server-only";
import { createAuthClient } from "@/server/supabase/server";
export async function submitDiagnostic(diagnosticId: string, expectedRevision: number) {
  const client = await createAuthClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (client as any).rpc("submit_diagnostic", { p_diagnostic_id: diagnosticId, p_expected_revision: expectedRevision });
  if (error) throw new Error(error.message);
  return data as { ok: boolean; status: string; job_id?: string; missing?: Array<{ question_id: string; block_id: string; position: number }> };
}
