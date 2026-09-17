import { z } from "zod";

const text = z.string().trim().min(1);
const positiveInteger = z.coerce.number().int().positive();
const nonNegativeInteger = z.coerce.number().int().nonnegative();

export const companyProfileSchema = z.object({
  name: text,
  industry_key: z.string().trim().min(1),
  country: text,
  products: text,
  customer_segments: text,
  sales_channels: text,
  employee_count: positiveInteger,
  annual_revenue_key: z.string().trim().min(1),
  company_age_years: nonNegativeInteger,
  management_levels: positiveInteger,
  key_problems: text,
  main_goals: text,
});
export type CompanyProfileInput = z.infer<typeof companyProfileSchema>;
export type CompanyProfileState = { error?: string; success?: string; fieldErrors?: Partial<Record<keyof CompanyProfileInput, string>>; values?: Partial<Record<keyof CompanyProfileInput, string>> };
