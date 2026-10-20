import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
const state = vi.hoisted(() => ({ entitled: false, rollout: true, active: null as null | { id: string },
  individual: vi.fn(), teams: vi.fn(), start: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/features/company/company-navigation", () => ({ CompanyNavigation: () => null }));
vi.mock("@/features/team/owner-forms", () => ({ CreateTeamForm: ({ companyId }: { companyId: string }) => createElement("form", {"data-company": companyId}, "Название команды") }));
vi.mock("@/server/entitlements", () => ({ hasEntitlement: async () => state.entitled }));
vi.mock("@/server/team/capabilities", () => ({ teamFoundationEnabled: () => state.rollout }));
vi.mock("@/server/team/service", () => ({ listTeamHistory: state.teams }));
vi.mock("@/server/diagnostic/actions", () => ({ startDiagnosticAction: state.start }));
vi.mock("@/server/diagnostic/service", () => ({ getActiveDiagnostic: async () => state.active, getLatestDiagnostics: state.individual }));
import { DiagnosticsHub } from "@/features/company/diagnostics-hub";
type Company = Parameters<typeof DiagnosticsHub>[0]["company"];
const company = { id: "company-a", account_id: "account-a", name: "Компания A" } as Company;
async function view(type?: string, selected = company) { return renderToStaticMarkup(await DiagnosticsHub({ company: selected, userId: "owner", type })); }
beforeEach(() => {
  vi.clearAllMocks(); state.entitled = false; state.rollout = true; state.active = null;
  state.individual.mockResolvedValue([]); state.teams.mockResolvedValue([]);
});
describe("unified Diagnostics entry", () => {
  it("shows equal-level Individual and locked Advanced Team choices on Free", async () => {
    const html = await view();
    expect(html).toContain("Какую диагностику вы хотите провести?");
    expect(html).toContain("Начать индивидуальную диагностику");
    expect(html).toContain("Командная диагностика доступна на тарифе Advanced.");
    expect(html).toContain('/ru/account/plan?account=account-a');
    expect(html).not.toContain('type=team'); expect(state.start).not.toHaveBeenCalled();
  });
  it("enables Team on Advanced but opening the chooser creates nothing", async () => {
    state.entitled = true;
    const html = await view();
    expect(html).toContain('type=team'); expect(html).not.toContain("Название команды");
    expect(state.start).not.toHaveBeenCalled();
  });
  it("opens the existing creation form only on explicit Team choice", async () => {
    state.entitled = true;
    const html = await view("team"); expect(html).toContain('data-company="company-a"');
    expect(state.start).not.toHaveBeenCalled();
  });
  it("does not let a query parameter unlock the Free Team form", async () => {
    expect(await view("team")).not.toContain("Название команды");
  });
  it("keeps rollout availability separate from commercial entitlement", async () => {
    state.entitled = true; state.rollout = false;
    const html = await view("team"); expect(html).not.toContain("Название команды");
    expect(html).toContain("пока недоступна"); expect(state.teams).not.toHaveBeenCalled();
  });
  it("retains an active individual attempt and offers a separate Team choice", async () => {
    state.active = { id: "active-id" }; state.entitled = true;
    const html = await view(); expect(html).toContain('/ru/diagnostics/active-id');
    expect(html).not.toContain("Начать индивидуальную диагностику"); expect(html).toContain("Создать командную диагностику");
  });
  it("preserves readable Team history after downgrade and labels both types", async () => {
    state.teams.mockResolvedValue([{ id: "old-team", title: "Прежняя команда", status: "closed", created_at: "2026-10-15", completedParticipants: 4 }]);
    state.individual.mockResolvedValue([{ diagnostic: { id: "old-individual", status: "completed", completed_at: "2026-10-15" }, result: null }]);
    const html = await view(); expect(html).toContain('/companies/company-a/teams/old-team');
    expect(html).toContain('/diagnostics/old-individual/result'); expect(html).toContain('Командная</p>');
    expect(html).toContain('Индивидуальная</p>'); expect(html).toContain("4 участника завершили");
  });
  it("switches both histories to the explicitly selected Company", async () => {
    await view(undefined, { ...company, id: "company-b" });
    expect(state.individual).toHaveBeenCalledWith("owner", "company-b");
    expect(state.teams).toHaveBeenCalledWith("company-b");
  });
});
