import { z } from "zod";

const text = z.string().trim().min(1).max(5000);
const optionalText = (max = 5000) => z.preprocess(
  (value) => value === undefined || value === null || typeof value === "string" && !value.trim() ? null : value,
  z.string().trim().max(max).nullable(),
);
const optionalInteger = (min: number) => z.preprocess(
  (value) => value === undefined || value === null || typeof value === "string" && !value.trim() ? null : value,
  z.coerce.number().int().min(min).max(10000).nullable(),
);

export const companyProfileSchema = z.object({
  name: text.max(200),
  industry_key: z.string().trim().min(1).max(80),
  country: optionalText(200),
  products: text,
  customer_segments: optionalText(),
  sales_channels: optionalText(),
  employee_count: z.coerce.number().int().positive().max(10000000),
  annual_revenue_key: optionalText(80),
  company_age_years: optionalInteger(0),
  management_levels: optionalInteger(1),
  key_problems: text,
  main_goals: text,
});
export type CompanyProfileInput = z.infer<typeof companyProfileSchema>;
export type CompanyProfileState = { error?: string; success?: string; fieldErrors?: Partial<Record<keyof CompanyProfileInput, string>>; values?: Partial<Record<keyof CompanyProfileInput, string>> };
