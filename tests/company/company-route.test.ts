import { beforeEach, describe, expect, it, vi } from "vitest";

const read = vi.hoisted(() => vi.fn());
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
vi.mock("@/server/account/authorization", () => ({
  AccountAccessError: class extends Error { constructor(public readonly code: string) { super(code); } },
  requireCompanyRead: read,
}));
import { AccountAccessError } from "@/server/account/authorization";
import { requireCompanyRoute } from "@/features/company/company-route";

beforeEach(() => { read.mockReset(); });

describe("explicit company route authorization", () => {
  it("resolves exactly the requested company with the signed-in actor", async () => {
    read.mockResolvedValue({ id: "company-b", account_id: "account-a" });
    await expect(requireCompanyRoute("company-b", "user-a")).resolves.toEqual({ id: "company-b", account_id: "account-a" });
    expect(read).toHaveBeenCalledWith("company-b", "user-a");
  });

  it("uses the same denied response for unauthorized and absent companies", async () => {
    read.mockRejectedValue(new AccountAccessError("not_found"));
    await expect(requireCompanyRoute("company-denied", "user-a")).rejects.toThrow("redirect:/ru/access-denied");
  });

  it("does not conceal unexpected data-load failures as empty onboarding", async () => {
    read.mockRejectedValue(new Error("database unavailable"));
    await expect(requireCompanyRoute("company-a", "user-a")).rejects.toThrow("database unavailable");
  });
});
