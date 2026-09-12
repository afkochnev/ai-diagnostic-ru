import { createClient } from "@supabase/supabase-js";
import { serviceConfig } from "./config";

// This module is for the standalone Node runtime only. It has no request or
// Next.js dependencies; the service-role credential never crosses that boundary.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createAdminClient() { const c = serviceConfig(); return createClient<any>(c.SUPABASE_URL, c.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } }); }
