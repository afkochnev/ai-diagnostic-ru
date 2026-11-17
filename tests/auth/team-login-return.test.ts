import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  jar: new Map<string, string>(), rpc: vi.fn(), query: vi.fn(), matches: [] as {id: string}[],
}));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({cookies: async () => ({
  get: (name: string) => state.jar.has(name) ? {value: state.jar.get(name)} : undefined,
  set: (name: string, value: string) => state.jar.set(name, value),
})}));
vi.mock("@/server/supabase/config", () => ({authConfig: () => ({AUTH_FLOW_SECRET: "synthetic-return-key", secure: true})}));
vi.mock("@/server/team/capabilities", () => ({teamFoundationEnabled: () => true}));
vi.mock("@/server/supabase/server", () => ({createAuthClient: async () => ({rpc: state.rpc})}));
vi.mock("@/server-runtime/supabase/admin", () => ({createAdminClient: () => ({
  from: () => ({
    select: () => ({
      eq: (...args: unknown[]) => {
        state.query(...args);
        return {is: () => ({in: () => ({eq: () => ({order: () => ({limit: async () => ({data: state.matches, error: null})})})})})};
      },
    }),
  }),
})}));
import { activeParticipantDestination, authorizedTeamReturn, consumeTeamLoginReturn, setTeamLoginReturn } from "@/server/auth/team-login-return";
import { safeMfaReturnTo, safeTeamResponseReturnTo } from "@/server/auth/mfa-return";

const first = "10000000-0000-4000-8000-000000000001";
const second = "20000000-0000-4000-8000-000000000001";
const teamPath = "/ru/team/responses/" + first;
beforeEach(() => {vi.restoreAllMocks(); state.jar.clear(); state.matches = []; state.rpc.mockReset().mockResolvedValue({error: null}); state.query.mockReset();});

describe("participant return context", () => {
  it("binds the encrypted continuation to the verified email, rejecting expiry and tampering", async () => {
    await setTeamLoginReturn("Participant@example.test", teamPath);
    const context = state.jar.get("team-login-return")!;
    expect(context).not.toContain(first);
    expect(context).not.toContain("participant@example.test");
    expect(await consumeTeamLoginReturn("participant@example.test")).toBe(teamPath);
    expect(await consumeTeamLoginReturn("participant@example.test")).toBeNull();

    state.jar.set("team-login-return", context);
    expect(await consumeTeamLoginReturn("other@example.test")).toBeNull();
    const altered = Buffer.from(context, "base64url");
    altered[35] ^= 1;
    state.jar.set("team-login-return", altered.toString("base64url"));
    expect(await consumeTeamLoginReturn("participant@example.test")).toBeNull();

    state.jar.set("team-login-return", context);
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 1800001);
    expect(await consumeTeamLoginReturn("participant@example.test")).toBeNull();
  });

  it.each(["https://external.test", "//external.test", teamPath + "?next=/ru/admin", teamPath + "#token=secret", "/ru/team/responses/not-a-uuid", "/ru/team/responses/" + first + "/result"])("rejects unsupported return path %s", async path => {
    expect(safeTeamResponseReturnTo(path)).toBeNull();
    expect(safeMfaReturnTo(path)).toBeNull();
    await setTeamLoginReturn("participant@example.test", path);
    expect(await consumeTeamLoginReturn("participant@example.test")).toBeNull();
  });

  it("preserves the questionnaire return through configured MFA", () => {
    expect(safeMfaReturnTo(teamPath)).toBe(teamPath);
  });

  it("steps up an administrator's own configured factor before the questionnaire can check access", async () => {
    const client = {
      rpc: async () => ({error: {message: "team_response_unavailable"}}),
      auth: {
        getUser: async () => ({data: {user: {id: "admin", email_confirmed_at: "confirmed"}}}),
        mfa: {getAuthenticatorAssuranceLevel: async () => ({data: {currentLevel: "aal1", nextLevel: "aal2"}})},
      },
      from: () => ({select: () => ({eq: () => ({single: async () => ({data: {role: "administrator"}})})})}),
    };
    expect(await authorizedTeamReturn(teamPath, client)).toBe("/ru/mfa?next=" + encodeURIComponent(teamPath));
  });

  it("only resumes a metadata candidate after the current participant RPC confirms access", async () => {
    state.matches = [{id: first}, {id: second}];
    state.rpc.mockResolvedValueOnce({error: {message: "team_response_unavailable"}});
    expect(await activeParticipantDestination("Participant@example.test")).toBe("/ru/team/responses/" + second);
    expect(state.query).toHaveBeenCalledExactlyOnceWith("email", "participant@example.test");
    expect(state.rpc.mock.calls).toEqual([
      ["read_team_response", {p_participant_id: first}],
      ["read_team_response", {p_participant_id: second}],
    ]);
  });

  it("offers normal onboarding when there is no owned questionnaire", async () => {
    state.matches = [{id: first}];
    state.rpc.mockResolvedValueOnce({error: {message: "team_response_unavailable"}});
    expect(await activeParticipantDestination("participant@example.test")).toBeNull();
    expect(await activeParticipantDestination(undefined)).toBeNull();
  });
});
