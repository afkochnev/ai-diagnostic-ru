import { z } from "zod";

export const consultationSchema = z.object({
  diagnostic_id: z.uuid(),
  report_id: z.uuid(),
  name: z.string().trim().min(2).max(100),
  contact_type: z.enum(["phone", "telegram"]).nullable().optional(),
  contact_value: z.string().trim().max(100).nullable().optional(),
  comment: z.string().trim().max(3000).nullable().optional(),
  idempotency_key: z.uuid(),
}).superRefine((value, ctx) => {
  const contact = value.contact_value?.trim() || null;
  if ((value.contact_type && !contact) || (!value.contact_type && contact)) ctx.addIssue({ code: "custom", path: ["contact_value"], message: "Укажите способ связи и значение контакта." });
  if (value.contact_type === "phone" && contact) {
    const digits = contact.replace(/[^0-9]/g, "");
    if (!/^\+?[0-9 ()-]{7,25}$/.test(contact) || digits.length < 7 || digits.length > 15) ctx.addIssue({ code: "custom", path: ["contact_value"], message: "Введите корректный номер телефона." });
  }
  if (value.contact_type === "telegram" && contact) {
    const username = contact.replace(/^https?:\/\/(www\.)?t\.me\//i, "").replace(/^@/, "");
    if (!/^[A-Za-z0-9_]{5,32}$/.test(username)) ctx.addIssue({ code: "custom", path: ["contact_value"], message: "Введите корректный Telegram username." });
  }
});

export function normalizeConsultationInput(value: z.infer<typeof consultationSchema>) {
  const contact = value.contact_value?.trim() || null;
  return {
    ...value,
    name: value.name.trim(),
    contact_value: value.contact_type === "phone" && contact ? contact.replace(/[() -]/g, "") : value.contact_type === "telegram" && contact ? contact.replace(/^https?:\/\/(www\.)?t\.me\//i, "").replace(/^@/, "").toLowerCase() : null,
    comment: value.comment?.trim() || null,
  };
}
