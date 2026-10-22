import "server-only";
import {createAdminClient} from "@/server/supabase/admin";

// Future marketing integrations must use this boundary immediately before sending.
// Transactional report/access/invitation messages do not depend on marketing consent.
export async function sendPermittedMarketing<T>(userId: string, send: () => Promise<T>): Promise<T> {
  const db = createAdminClient();
  const {data, error} = await db.rpc("marketing_send_allowed", {p_user_id: userId});
  if (error || data !== true) throw new Error("marketing_not_allowed");
  return send();
}
