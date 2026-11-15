import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, PATCH } from "@/app/api/team/responses/[participantId]/route";

const mocks = vi.hoisted(() => ({ getIdentity: vi.fn(), participantResponse: vi.fn(), save: vi.fn() }));
vi.mock("@/server/auth/session", () => ({ getIdentity: mocks.getIdentity }));
vi.mock("@/server/team/service", () => ({ participantResponse: mocks.participantResponse }));
vi.mock("@/server/team/actions", () => ({ saveTeamResponseAction: mocks.save }));
vi.mock("@/server/team/capabilities", () => ({ teamFoundationEnabled: () => true }));
vi.mock("@/server/supabase/config", () => ({ authConfig: () => ({ APP_URL: "https://test.example" }) }));

const participantId = "10000000-0000-4000-8000-000000000001";
const questionId = "20000000-0000-4000-8000-000000000001";
const context = { params: Promise.resolve({ participantId }) };
const url = "https://test.example/api/team/responses/" + participantId;
const answers = { [questionId]: "Мой ответ" };
const write = (origin = "https://test.example") => new Request(url, {
  method: "PATCH",
  headers: { origin, "content-type": "application/json" },
  body: JSON.stringify({ revision: 4, submit: true, answers }),
});

beforeEach(() => {
  mocks.getIdentity.mockReset().mockResolvedValue({ role: "user", user: { email_confirmed_at: "verified" } });
  mocks.participantResponse.mockReset().mockResolvedValue({ answers, revision: 5, status: "completed", questions: ["not returned"] });
  mocks.save.mockReset().mockResolvedValue({ revision: 5, status: "completed" });
});

describe("team response transport", () => {
  it("returns no state without verified identity and hides responses denied by the participant RPC", async () => {
    mocks.getIdentity.mockResolvedValueOnce(null);
    expect((await GET(new Request(url), context)).status).toBe(401);
    expect(mocks.participantResponse).not.toHaveBeenCalled();

    mocks.participantResponse.mockRejectedValueOnce(Error("team_response_unavailable"));
    const denied = await GET(new Request(url), context);
    expect(denied.status).toBe(404);
    expect(denied.headers.get("cache-control")).toBe("private, no-store");
    expect(await denied.json()).toEqual({ error: "not_found" });
  });

  it("returns only own save reconciliation fields with no cache", async () => {
    const result = await GET(new Request(url), context);
    expect(mocks.participantResponse).toHaveBeenCalledExactlyOnceWith(participantId);
    expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(await result.json()).toEqual({ answers, revision: 5, status: "completed" });
  });

  it("blocks cross-origin writes before dispatching the existing authenticated action", async () => {
    expect((await PATCH(write("https://foreign.example"), context)).status).toBe(403);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("binds writes to the path participant and keeps uncertainty distinct from conflicts", async () => {
    const result = await PATCH(write(), context);
    expect(result.status).toBe(200);
    const [previous, form] = mocks.save.mock.calls[0];
    expect(previous).toEqual({ revision: 4 });
    expect(Object.fromEntries(form)).toEqual({ participantId, revision: "4", intent: "submit", answers: JSON.stringify(answers) });
    mocks.save.mockResolvedValueOnce({ error: "Conflict", saveFailure: "conflict" });
    expect((await PATCH(write(), context)).status).toBe(409);
    mocks.save.mockResolvedValueOnce({ error: "Unavailable", saveFailure: "uncertain" });
    expect((await PATCH(write(), context)).status).toBe(503);
  });
});
