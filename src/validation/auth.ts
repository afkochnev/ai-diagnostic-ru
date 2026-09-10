import { z } from "zod";

export const emailSchema = z.email().max(254);
export const passwordSchema = z.string().min(8).max(1024);
export const registrationSchema = z.object({
  full_name: z.string().trim().min(1).max(200),
  email: emailSchema,
  password: passwordSchema,
  confirm_password: z.string().max(1024),
  data_processing_consent: z.literal(true),
  marketing_consent: z.boolean(),
}).refine((data) => data.password === data.confirm_password, { path: ["confirm_password"], message: "Passwords do not match" });
export const loginSchema = z.object({ email: emailSchema, password: z.string().min(1).max(1024) });
export type AuthState = { error?: string; success?: string; factorId?: string; secret?: string; uri?: string };
