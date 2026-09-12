import { z } from "zod";

const schema = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  APP_URL: z.url(),
  AUTH_FLOW_SECRET: z.string().min(32),
});
const serviceSchema = schema.extend({ SUPABASE_SERVICE_ROLE_KEY: z.string().min(1) });

export function authConfig() {
  const result = schema.safeParse(process.env);
  if (!result.success) throw new Error("Auth environment is missing or invalid; see .env.example");
  const config = result.data;
  const origin = new URL(config.APP_URL);
  if (origin.pathname !== "/" || origin.search || origin.hash) throw new Error("APP_URL must be an origin");
  if (origin.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(origin.hostname)) throw new Error("APP_URL requires HTTPS");
  return { ...config, APP_URL: origin.origin, secure: origin.protocol === "https:" };
}

export function isAuthConfigured() { return schema.safeParse(process.env).success; }
export function serviceConfig() {
  const result = serviceSchema.safeParse(process.env);
  if (!result.success) throw new Error("Service role environment is missing; see .env.example");
  return result.data;
}
