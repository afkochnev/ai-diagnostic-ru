import { beforeEach, describe, expect, it, vi } from "vitest";
const deps = vi.hoisted(() => ({ identity: vi.fn(), result: vi.fn(), render: vi.fn(), limit: vi.fn(), enabled: vi.fn() }));
vi.mock("@/server/auth/session", () => ({ getIdentity: deps.identity }));
vi.mock("@/server/team/participant-result-service", () => ({ getParticipantResult: deps.result }));
vi.mock("@/server/team/participant-result-pdf-render", () => ({ renderParticipantResultPdf: deps.render }));
vi.mock("@/server/team/capabilities", () => ({ teamFoundationEnabled: deps.enabled }));
vi.mock("@/server/rate-limit", () => ({ enforceRateLimit: deps.limit, RateLimitExceeded: class extends Error { retryAfter = 60; } }));
import { GET } from "@/app/api/team/responses/[participantId]/result/pdf/route";
import { RateLimitExceeded } from "@/server/rate-limit";

const id = "10000000-0000-4000-8000-000000000001";
const params = (participantId = id) => ({ params: Promise.resolve({ participantId }) });
const request = () => new Request("https://example.test/api/team/responses/id/result/pdf");
beforeEach(() => {
  vi.resetAllMocks();
  deps.enabled.mockReturnValue(true);
  deps.identity.mockResolvedValue({ user: { id: "self", email_confirmed_at: "date" }, role: "user" });
  deps.result.mockResolvedValue({ participant_id: id, overall_display: 50 });
  deps.render.mockResolvedValue(Buffer.from("%PDF-self"));
});

describe("self-only Team participant PDF boundary", () => {
  it("denies anonymous or unverified access without reading the result or rendering", async () => {
    deps.identity.mockResolvedValueOnce(null).mockResolvedValueOnce({ user: { id: "self" } });
    for (let i = 0; i < 2; i++) expect((await GET(request(), params())).status).toBe(401);
    expect(deps.result).not.toHaveBeenCalled(); expect(deps.render).not.toHaveBeenCalled();
  });
  it("does not bypass the Team capability or UUID boundary", async () => {
    deps.enabled.mockReturnValueOnce(false);
    expect((await GET(request(), params())).status).toBe(404);
    expect((await GET(request(), params("not-a-uuid"))).status).toBe(404);
    expect(deps.result).not.toHaveBeenCalled();
  });
  it("renders only an authorized completed result and never caches the attachment", async () => {
    const response = await GET(request(), params());
    expect(response.status).toBe(200);
    expect(deps.result).toHaveBeenCalledWith(id);
    expect(deps.render).toHaveBeenCalledWith({ participant_id: id, overall_display: 50 });
    expect(deps.limit).toHaveBeenCalledWith("team-participant-pdf:self", 6, 60);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toContain("attachment;");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.text()).toBe("%PDF-self");
  });
  it("returns no bytes for someone else's, revoked, missing or incomplete result", async () => {
    for (const [message, status] of [["team_response_unavailable", 404], ["team_result_unavailable", 404], ["team_result_incomplete", 409]] as const) {
      deps.result.mockRejectedValueOnce(new Error(message));
      const response = await GET(request(), params());
      expect(response.status).toBe(status);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
    expect(deps.render).not.toHaveBeenCalled(); expect(deps.limit).not.toHaveBeenCalled();
  });
  it("limits expensive rendering and returns a bounded retry time", async () => {
    deps.limit.mockRejectedValueOnce(new RateLimitExceeded(60));
    const response = await GET(request(), params());
    expect(response.status).toBe(429); expect(response.headers.get("retry-after")).toBe("60");
    expect(deps.render).not.toHaveBeenCalled();
  });
  it("does not expose technical failure details", async () => {
    deps.render.mockRejectedValueOnce(new Error("sensitive provider diagnostic"));
    const response = await GET(request(), params());
    expect(response.status).toBe(500);
    expect(await response.text()).toBe('{"error":"pdf_failed"}');
  });
});
