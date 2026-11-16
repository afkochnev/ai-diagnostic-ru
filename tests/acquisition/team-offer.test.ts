import { beforeEach, describe, expect, it, vi } from "vitest";
import { Children, isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const state = vi.hoisted(() => ({
  advanced: false,
  listTeams: vi.fn(),
  track: vi.fn(),
  redirect: vi.fn((url: string) => { throw Error(url); }),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: state.redirect }));
vi.mock("@/server/auth/session", () => ({ requireIdentity: async () => ({ user: { id: "owner" } }) }));
vi.mock("@/server/account/authorization", () => ({
  requireCompanyWrite: async (id: string) => ({ id, account_id: "account" }),
}));
vi.mock("@/server/acquisition/context", () => ({ guardOrigin: vi.fn() }));
vi.mock("@/server/acquisition/contracts", () => ({ acquisitionEnabled: () => true }));
vi.mock("@/server/acquisition/service", () => ({ trackInteraction: state.track }));
vi.mock("@/server/entitlements", () => ({
  getAccountPlan: async () => ({ entitlements: { team_diagnostics: state.advanced } }),
}));
vi.mock("@/server/team/service", () => ({ listTeams: state.listTeams }));
vi.mock("@/server/team/capabilities", () => ({ teamFoundationEnabled: () => true }));
vi.mock("@/features/acquisition/tracking", () => ({ MilestoneView: () => null }));

import { TeamOffer } from "@/features/acquisition/team-offer";

const companyId = "44444444-4444-4444-8444-444444444444";
const company = `/ru/companies/${companyId}`;
const plan = `/ru/account/plan?account=account&company=${companyId}`;
const offer = () => TeamOffer({ companyId, accountId: "account" });

async function freeAction() {
  const element = await offer();
  const cta = Children.toArray(element?.props.children).at(-1);
  if (!isValidElement<{ children: ReactElement<{ action: () => Promise<void> }>[] }>(cta)) {
    throw Error("missing_team_offer_cta");
  }
  return cta.props.children[0].props.action;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.advanced = false;
  state.listTeams.mockResolvedValue([]);
  state.track.mockResolvedValue(undefined);
});

describe("Team offer after individual diagnostics", () => {
  it("sends Free to the selected company's plan even when an open Team exists", async () => {
    state.listTeams.mockResolvedValue([{ id: "team", status: "open" }]);
    const html = renderToStaticMarkup(await offer());
    expect(html).toContain("Провести командную диагностику");
    expect(html).toContain("введите промокод");
    expect(html).not.toContain("/teams/team");
    expect(state.listTeams).not.toHaveBeenCalled();
    await expect((await freeAction())()).rejects.toThrow(plan);
    expect(state.track).toHaveBeenCalledWith("advanced_cta_clicked", companyId, null, "individual_report");
  });

  it("opens the plan even if recording the acquisition event fails", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      state.track.mockRejectedValueOnce(Error("acquisition_event_unavailable"));
      await expect((await freeAction())()).rejects.toThrow(plan);
    } finally {
      warning.mockRestore();
    }
  });

  it("opens the dedicated creation step or the existing open Team on Advanced", async () => {
    state.advanced = true;
    expect(renderToStaticMarkup(await offer())).toContain(`${company}/diagnostics?new=1&amp;type=team#team-create`);
    state.listTeams.mockResolvedValue([{ id: "team", status: "open" }]);
    expect(renderToStaticMarkup(await offer())).toContain(`${company}/teams/team`);
  });
});
