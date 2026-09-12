import { describe, expect, it } from "vitest";
import { consultationSchema, normalizeConsultationInput } from "@/server/consultation/validation";
import { buildConsultationNotification } from "@/server/consultation/content";
import { readFileSync } from "node:fs";

const base = { diagnostic_id: "9152284d-1974-4a60-a80f-2adee6bf6fd5", report_id: "3c3eaba9-f081-4fab-aae7-8bd6409bbc9a", name: "Иван Петров", contact_type: null, contact_value: null, comment: null, idempotency_key: "11111111-1111-4111-8111-111111111111" };

describe("consultation lead contract", () => {
  it("validates and normalizes phone", () => {
    const parsed = consultationSchema.safeParse({ ...base, contact_type: "phone", contact_value: "+7 (999) 123-45-67" });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(normalizeConsultationInput(parsed.data).contact_value).toBe("+79991234567");
  });
  it("normalizes Telegram forms", () => {
    const parsed = consultationSchema.safeParse({ ...base, contact_type: "telegram", contact_value: "https://t.me/Test_User" });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(normalizeConsultationInput(parsed.data).contact_value).toBe("test_user");
  });
  it("requires contact pairs and validates limits", () => {
    expect(consultationSchema.safeParse({ ...base, contact_value: "12345678" }).success).toBe(false);
    expect(consultationSchema.safeParse({ ...base, contact_type: "phone" }).success).toBe(false);
    expect(consultationSchema.safeParse({ ...base, name: "A" }).success).toBe(false);
    expect(consultationSchema.safeParse({ ...base, comment: "x".repeat(3001) }).success).toBe(false);
  });
  it("builds an admin notification without PDF or secrets", () => {
    const message = buildConsultationNotification({ companyName: "МедТех", name: "Иван", email: "user@example.test", contactType: "telegram", contactValue: "owner", comment: "Обсудить результаты" });
    expect(message.subject).toContain("МедТех");
    expect(message.text).toContain("owner");
    expect(message.text).not.toContain("OPENAI_API_KEY");
    expect(message.text).not.toContain("JVBER");
  });
  it("keeps lifecycle and security requirements in implementation", () => {
    const migration = readFileSync("supabase/migrations/20260914000300_consultation_leads.sql", "utf8");
    const service = readFileSync("src/server/consultation/service.ts", "utf8");
    const ui = readFileSync("src/features/consultation/consultation-modal.tsx", "utf8");
    expect(migration).toContain("lead_requests_active_idx");
    expect(migration).toContain("create_lead_request");
    expect(migration).toContain("consultation_notification");
    expect(migration).toContain("lead_requests_owner_read");
    expect(service).not.toContain("openai");
    expect(service).not.toContain("score");
    expect(ui).toContain("Заявка уже отправлена.");
    expect(ui).toContain("Спасибо! Заявка отправлена.");
  });
  it("uses one lease-based worker path for local and scheduled execution", () => {
    const worker = readFileSync("src/server/consultation/worker.ts", "utf8");
    const route = readFileSync("src/app/api/internal/workers/consultation/route.ts", "utf8");
    const runner = readFileSync("scripts/consultation-worker.ts", "utf8");
    expect(worker).toContain("runPendingConsultationNotifications");
    expect(worker).toContain("claim_consultation_notification_jobs");
    expect(worker).toContain("lease_token");
    expect(worker).toContain("available_at");
    expect(worker).toContain("before_claim");
    expect(worker).toContain("claim_success");
    expect(worker).toContain("claim_error");
    expect(route).toContain("route_error");
    expect(route).toContain('error: "worker_failed"');
    expect(route).toContain("x-worker-secret");
    expect(route).toContain("runPendingConsultationNotifications");
    expect(runner).toContain("/api/internal/workers/consultation");
    expect(runner).toContain("main().catch");
    expect(runner).not.toMatch(/^await run\(\)/m);
    expect(runner).toContain("process.argv.includes(\"--once\")");
    expect(runner).toContain("--env-file=.env.local");
  });
  it("uses explicit aliases in the claim RPC to avoid PL/pgSQL output conflicts", () => {
    const migration = readFileSync("supabase/migrations/20260914000600_fix_consultation_claim_ambiguity.sql", "utf8");
    expect(migration).toContain("j.lease_token as claimed_lease_token");
    expect(migration).toContain("c.claimed_lease_token");
    expect(migration).toContain("for update of j skip locked");
    expect(migration).not.toContain("select id, lead_id, lease_token, attempts from claimed");
  });
});
