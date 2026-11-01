import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({ tables: {} as Record<string, Row[]>, failSentWrite: false }));
function database() {
  return {
    rpc: async (_name: string, args: { p_max_attempts: number }) => {
      const job = state.tables.jobs.find((row) => row.status === "queued" || row.status === "failed" && Number(row.attempts) < args.p_max_attempts && Date.parse(String(row.available_at)) <= Date.now());
      if (!job) return { data: [], error: null };
      job.status = "running"; job.attempts = Number(job.attempts) + 1; job.lease_token = `lease-${job.attempts}`;
      return { data: [{ job_id: job.id, lead_request_id: "lead", lease_token: job.lease_token, attempt_count: job.attempts }], error: null };
    },
    from(table: string) {
      const filters: ((row: Row) => boolean)[] = [];
      let update: Row | undefined;
      const execute = () => {
        if (table === "consultation_notification_deliveries" && update?.status === "sent" && state.failSentWrite) return { data: null, error: { code: "storage_unavailable" } };
        const rows = (state.tables[table] ?? []).filter((row) => filters.every((filter) => filter(row)));
        if (update) rows.forEach((row) => Object.assign(row, update));
        return { data: rows, error: null };
      };
      const chain = {
        select: () => chain,
        is: (key: string, value: unknown) => { filters.push((row) => row[key] === value); return chain; },
        eq: (key: string, value: unknown) => { filters.push((row) => row[key] === value); return chain; },
        in: (key: string, values: unknown[]) => { filters.push((row) => values.includes(row[key])); return chain; },
        update: (value: Row) => { update = value; return chain; },
        maybeSingle: async () => { const r = execute(); return { ...r, data: r.data?.[0] ?? null }; },
        then: (resolve: (value: ReturnType<typeof execute>) => unknown) => Promise.resolve(execute()).then(resolve),
      };
      return chain;
    },
  };
}
vi.mock("@/server-runtime/supabase/admin", () => ({ createAdminClient: database }));
import { runConsultationNotification, runPendingConsultationNotifications } from "@/server/consultation/worker";
import { getConsultationProvider, MockConsultationProvider } from "@/server/consultation/provider";
import { consultationDestination } from "@/server/consultation/config";

const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubEnv("EMAIL_PROVIDER", "resend");
  vi.stubEnv("RESEND_API_KEY", "synthetic-test-key");
  vi.stubEnv("EMAIL_FROM", "Audit <audit@example.test>");
  vi.stubEnv("CONSULTATION_NOTIFICATION_EMAIL", "approved@example.test");
  vi.stubEnv("CONSULTATION_MAX_ATTEMPTS", "5");
  fetchMock.mockReset().mockResolvedValue(new Response(JSON.stringify({ id: "provider-message" }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  MockConsultationProvider.sent = [];
  state.failSentWrite = false;
  state.tables = {
    jobs: [{ id: "job", kind: "consultation_notification", status: "queued", attempts: 0, lease_token: null, available_at: new Date(0).toISOString() }],
    lead_requests: [{ id: "lead", company_id: "company", name: "Fixture Owner", email: "fixture@example.test", contact_type: null, contact_value: null, comment: "Synthetic consultation", diagnostic_id: "diagnostic" }],
    consultation_notification_deliveries: [{ id: "delivery", lead_request_id: "lead", job_id: "job", status: "queued" }],
    company_profiles: [{ id: "company", name: "Synthetic company" }],
  };
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const job = () => state.tables.jobs[0];
const delivery = () => state.tables.consultation_notification_deliveries[0];

describe("consultation delivery lifecycle", () => {
  it("delivers a Team consultation through the same queue without an Individual diagnostic or private answers", async () => {
    vi.stubEnv("EMAIL_PROVIDER", "mock");
    Object.assign(state.tables.lead_requests[0], {diagnostic_id: null, report_id: null, team_diagnostic_id: "team", team_report_id: "team-report"});
    Object.assign(job(), {diagnostic_id: null, team_diagnostic_id: "team"});
    expect((await runPendingConsultationNotifications(1)).results).toEqual([{status: "sent"}]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(MockConsultationProvider.sent).toHaveLength(1);
    expect(job().status).toBe("completed");
    expect(delivery()).toMatchObject({status: "sent", provider: "mock"});
    expect(JSON.stringify(MockConsultationProvider.sent)).not.toContain("answers");
  });
  it("calls the real adapter once with the configured recipient, safe content and stable idempotency key", async () => {
    expect((await runPendingConsultationNotifications(1)).results).toEqual([{ status: "sent" }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(options.headers["Idempotency-Key"]).toBe("consultation-notification/delivery");
    expect(JSON.parse(options.body)).toMatchObject({ to: ["approved@example.test"], from: "Audit <audit@example.test>", subject: "Новая заявка на консультацию — Synthetic company" });
    expect(JSON.parse(options.body).text).toContain("fixture@example.test");
    expect(options.body).not.toContain("synthetic-test-key");
    expect(delivery()).toMatchObject({ status: "sent", provider: "resend", provider_message_id: "provider-message", attempt_count: 1 });
    expect(job()).toMatchObject({ status: "completed", attempts: 1, lease_token: null, last_error_code: null });
  });

  it("does not call the provider again for a previously sent delivery, and completes its reclaimed job", async () => {
    await runPendingConsultationNotifications(1);
    job().status = "queued";
    await runPendingConsultationNotifications(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(job().status).toBe("completed");
  });

  it("records explicit terminal failure when destination is missing", async () => {
    vi.stubEnv("CONSULTATION_NOTIFICATION_EMAIL", "");
    expect((await runPendingConsultationNotifications(1)).results).toEqual([{ status: "failed" }]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(job()).toMatchObject({ status: "failed", last_error_code: "consultation_destination_not_configured", lease_token: null, attempts: 5 });
    expect(delivery().status).toBe("failed");
  });

  it("rejects malformed destination and unknown provider without sending", async () => {
    vi.stubEnv("CONSULTATION_NOTIFICATION_EMAIL", "first@example.test,second@example.test");
    expect(() => consultationDestination()).toThrow("consultation_destination_invalid");
    vi.stubEnv("CONSULTATION_NOTIFICATION_EMAIL", "approved@example.test");
    vi.stubEnv("EMAIL_PROVIDER", "resned");
    await runPendingConsultationNotifications(1);
    expect(job().last_error_code).toBe("consultation_provider_invalid");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["RESEND_API_KEY", "EMAIL_FROM"])("fails explicitly if required real-provider %s is absent", async (name) => {
    vi.stubEnv(name, ""); await runPendingConsultationNotifications(1);
    expect(job()).toMatchObject({ status: "failed", last_error_code: "consultation_provider_not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([429, 500, 503])("keeps provider HTTP %s retryable and releases the lease", async (status) => {
    fetchMock.mockResolvedValue(new Response("provider-error", { status }));
    await runPendingConsultationNotifications(1);
    expect(job()).toMatchObject({ status: "failed", attempts: 1, last_error_code: `consultation_provider_${status}`, lease_token: null });
    expect(Date.parse(String(job().available_at))).toBeLessThan(Date.now() + 3600000);
    expect(delivery().status).toBe("failed");
  });

  it.each([400, 401, 403])("parks permanent provider HTTP %s without silently completing", async (status) => {
    fetchMock.mockResolvedValue(new Response("provider-error", { status }));
    await runPendingConsultationNotifications(1);
    expect(job()).toMatchObject({ status: "failed", attempts: 5, last_error_code: `consultation_provider_${status}` });
  });

  it("does not accept HTTP success without a provider message ID", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    await runPendingConsultationNotifications(1);
    expect(job()).toMatchObject({ status: "failed", last_error_code: "consultation_provider_receipt_missing" });
  });

  it("makes no external email call for mock and records the actual provider", async () => {
    vi.stubEnv("EMAIL_PROVIDER", "mock");
    await runPendingConsultationNotifications(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(MockConsultationProvider.sent).toHaveLength(1);
    expect(delivery()).toMatchObject({ status: "sent", provider: "mock" });
    expect(job().status).toBe("completed");
  });

  it("retains the same idempotency key after a send whose database receipt could not be persisted", async () => {
    state.failSentWrite = true;
    await runPendingConsultationNotifications(1);
    expect(job()).toMatchObject({ status: "failed", last_error_code: "consultation_delivery_persist_failed" });
    state.failSentWrite = false; job().available_at = new Date(0).toISOString();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "provider-message" }), { status: 200 }));
    await runPendingConsultationNotifications(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([, options]) => options.headers["Idempotency-Key"])).toEqual(["consultation-notification/delivery", "consultation-notification/delivery"]);
    expect(job().status).toBe("completed");
  });

  it("converts network errors to a safe retryable code without leaking the error text", async () => {
    fetchMock.mockRejectedValue(new Error("sensitive-network-context"));
    await runPendingConsultationNotifications(1);
    expect(job().last_error_code).toBe("consultation_provider_unavailable");
    expect(JSON.stringify(job())).not.toContain("sensitive-network-context");
  });

  it("rejects invalid sender config before an external provider request", async () => {
    vi.stubEnv("EMAIL_FROM", "invalid sender");
    const provider = getConsultationProvider();
    await expect(provider.send({ to: "approved@example.test", subject: "Fixture", text: "Fixture", idempotencyKey: "fixture" })).rejects.toThrow("consultation_sender_invalid");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("exact-lead execution isolation", () => {
  it("claims only the requested lead even when another job is first in the queue", async () => {
    state.tables.jobs.unshift({ id: "unrelated-job", kind: "consultation_notification", status: "queued", attempts: 0, lease_token: null });
    expect(await runConsultationNotification("lead")).toEqual({ status: "sent" });
    expect(state.tables.jobs[0]).toMatchObject({ id: "unrelated-job", status: "queued", attempts: 0 });
    expect(state.tables.jobs[1]).toMatchObject({ id: "job", status: "completed", attempts: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await runConsultationNotification("lead");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each(["running", "completed"])("does not take a %s job or another lease", async (status) => {
    job().status = status; job().lease_token = "another-worker";
    expect(await runConsultationNotification("lead")).toEqual({ status: "not_claimed" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("does not retry a future or exhausted job", async () => {
    job().status = "failed"; job().available_at = "2099-01-01T00:00:00Z";
    expect(await runConsultationNotification("lead")).toEqual({ status: "not_claimed" });
    job().available_at = new Date(0).toISOString(); job().attempts = 5;
    expect(await runConsultationNotification("lead")).toEqual({ status: "not_claimed" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("limits the bounded smoke to one attempt even on transient provider failure", async () => {
    vi.stubEnv("CONSULTATION_MAX_ATTEMPTS", "1");
    fetchMock.mockResolvedValue(new Response("unavailable", { status: 503 }));
    expect(await runConsultationNotification("lead")).toEqual({ status: "failed" });
    expect(await runConsultationNotification("lead")).toEqual({ status: "not_claimed" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
