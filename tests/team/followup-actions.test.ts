import {beforeEach, describe, expect, it, vi} from "vitest";
const mocks = vi.hoisted(() => ({rpc: vi.fn()}));
vi.mock("server-only", () => ({}));
vi.mock("@/server/supabase/server", () => ({createAuthClient: async () => ({rpc: mocks.rpc})}));
vi.mock("@/server/account/authorization", () => ({requireDiagnosticRead: vi.fn(), AccountAccessError: class extends Error {}}));
import {createConsultationLead} from "@/server/consultation/service";
import {createFeedback} from "@/server/feedback/service";

const diagnostic = "10000000-0000-4000-8000-000000000001", report = "10000000-0000-4000-8000-000000000002";
const contact = {name: "Организатор", contact_type: "telegram", contact_value: "@Owner_User", comment: " Обсудить общий результат ", idempotency_key: "10000000-0000-4000-8000-000000000003"};
beforeEach(() => {vi.clearAllMocks(); mocks.rpc.mockResolvedValue({data: {ok: true, duplicate: false}, error: null});});
describe("Individual and Team follow-up routing", () => {
  it("retains the original Individual consultation and feedback RPC contracts", async () => {
    await createConsultationLead({...contact, diagnostic_id: diagnostic, report_id: report});
    expect(mocks.rpc).toHaveBeenLastCalledWith("create_lead_request", {p_diagnostic_id: diagnostic, p_report_id: report, p_name: "Организатор", p_contact_type: "telegram", p_contact_value: "owner_user", p_comment: "Обсудить общий результат", p_idempotency_key: contact.idempotency_key});
    await createFeedback({diagnostic_id: diagnostic, rating: 4, useful: " Полезно "});
    expect(mocks.rpc).toHaveBeenLastCalledWith("create_feedback", {p_diagnostic_id: diagnostic, p_rating: 4, p_useful: "Полезно", p_improve: null});
  });
  it("routes Team actions to their completed-report authorization boundary without an Individual ID", async () => {
    await createConsultationLead({...contact, team_diagnostic_id: diagnostic, team_report_id: report});
    expect(mocks.rpc).toHaveBeenLastCalledWith("create_team_lead_request", {p_team_diagnostic_id: diagnostic, p_team_report_id: report, p_name: "Организатор", p_contact_type: "telegram", p_contact_value: "owner_user", p_comment: "Обсудить общий результат", p_idempotency_key: contact.idempotency_key});
    await createFeedback({team_diagnostic_id: diagnostic, team_report_id: report, rating: 5});
    expect(mocks.rpc).toHaveBeenLastCalledWith("create_team_feedback", {p_team_diagnostic_id: diagnostic, p_team_report_id: report, p_rating: 5, p_useful: null, p_improve: null});
  });
  it("rejects incomplete or mixed subjects before persistence", async () => {
    for (const target of [{team_diagnostic_id: diagnostic}, {team_report_id: report}, {team_diagnostic_id: diagnostic, team_report_id: report, diagnostic_id: diagnostic}]) {
      await expect(createConsultationLead({...contact, ...target})).rejects.toThrow("invalid_consultation_input");
      await expect(createFeedback({...target, rating: 5})).rejects.toThrow("invalid_feedback_input");
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
