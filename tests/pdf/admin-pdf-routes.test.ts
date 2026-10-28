import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ admin: vi.fn(), status: vi.fn(), prepare: vi.fn(), limit: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/server/auth/admin", () => ({ requireAdmin: m.admin }));
vi.mock("@/server/pdf/service", () => ({ getAdminPdfStatus: m.status, preparePdfForAdminReport: m.prepare, adminPdfError: (e: unknown) => e instanceof Error && /^pdf_(access_denied|artifact_not_ready|report_not_ready|result_missing|source_conflict|artifact_conflict|integrity_failed)$/.test(e.message) ? e.message : "pdf_prepare_failed" }));
vi.mock("@/server/rate-limit", () => ({ enforceRateLimit: m.limit, RateLimitExceeded: class extends Error { retryAfter = 60; } }));
import { GET } from "@/app/api/admin/reports/[reportId]/pdf/route";
import { POST } from "@/app/api/admin/reports/[reportId]/pdf/prepare/route";
import { RateLimitExceeded } from "@/server/rate-limit";
const id = "10000000-0000-4000-8000-000000000001";
const ctx = (reportId = id) => ({ params: Promise.resolve({ reportId }) });
const req = (headers: HeadersInit = { origin: "https://app.test", "sec-fetch-site": "same-origin" }, body?: string) => new Request("https://app.test/api/admin", { method: "POST", headers, ...(body !== undefined ? { body } : {}) });
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("APP_URL", "https://app.test"); m.admin.mockResolvedValue({ user: { id: "actual-admin" } }); m.status.mockResolvedValue({ status: "ready", report_id: id }); m.prepare.mockResolvedValue({ status: "ready", report_id: id }); m.limit.mockResolvedValue(undefined); });
describe("separate admin PDF HTTP boundary", () => {
  it.each([GET, POST])("denies ordinary/unverified/absent/revoked authority before service", async route => {
    m.admin.mockRejectedValue(Error("redirect:denied")); await expect(route(req(), ctx())).rejects.toThrow("denied"); expect(m.status).not.toHaveBeenCalled(); expect(m.prepare).not.toHaveBeenCalled(); expect(m.limit).not.toHaveBeenCalled();
  });
  it.each([GET, POST])("invalid id fails before DB service", async route => { expect((await route(req(), ctx("bad"))).status).toBe(404); expect(m.status).not.toHaveBeenCalled(); expect(m.prepare).not.toHaveBeenCalled(); });
  it.each([{}, { origin: "https://evil.test" }, { origin: "https://app.test", "sec-fetch-site": "cross-site" }] as Record<string, string>[])("denies missing/foreign Origin/site before limiter/write", async headers => { expect((await POST(req(headers), ctx())).status).toBe(403); expect(m.limit).not.toHaveBeenCalled(); expect(m.prepare).not.toHaveBeenCalled(); });
  it.each([{ actorId: "forged" }, { ownerId: "foreign-owner" }, { template: "other", html: "untrusted" }, {}])("rejects all supplied bodies", async body => { expect((await POST(req(undefined, JSON.stringify(body)), ctx())).status).toBe(400); expect(m.prepare).not.toHaveBeenCalled(); expect(m.limit).not.toHaveBeenCalled(); });
  it("accepts a truly empty stream body from the HTTP adapter", async () => { expect((await POST(req(undefined, ""), ctx())).status).toBe(200); expect(m.prepare).toHaveBeenCalledOnce(); });
  it("POST binds its limiter to actual admin and passes only exact report id", async () => { const r = await POST(req(), ctx()); expect(r.status).toBe(200); expect(m.limit).toHaveBeenCalledExactlyOnceWith("admin-pdf-prepare:user:actual-admin", 5, 3600); expect(m.prepare).toHaveBeenCalledExactlyOnceWith(id); expect(r.headers.get("Cache-Control")).toContain("no-store"); expect(r.headers.get("Referrer-Policy")).toBe("no-referrer"); });
  it("GET never calls limiter or preparation", async () => { expect((await GET(new Request("https://app.test"), ctx())).status).toBe(200); expect(m.status).toHaveBeenCalledExactlyOnceWith(id); expect(m.limit).not.toHaveBeenCalled(); expect(m.prepare).not.toHaveBeenCalled(); });
  it("rate limit stops before preparation and is not reset", async () => { m.limit.mockRejectedValue(new RateLimitExceeded(60)); const r = await POST(req(), ctx()); expect(r.status).toBe(429); expect(r.headers.get("Retry-After")).toBe("60"); expect(m.prepare).not.toHaveBeenCalled(); });
  it.each([["pdf_report_not_ready", 409, "pdf_not_ready"], ["pdf_artifact_conflict", 409, "pdf_artifact_conflict"], ["pdf_integrity_failed", 409, "pdf_integrity_failed"], ["pdf_access_denied", 404, "not_found"], ["raw credential provider error", 500, "pdf_prepare_failed"]])("maps %s to safe bounded error", async (code, status, safe) => { m.prepare.mockRejectedValue(Error(String(code))); const r = await POST(req(), ctx()); expect(r.status).toBe(status); expect(await r.json()).toEqual({ error: safe }); });
});
