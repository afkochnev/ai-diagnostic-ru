import { beforeEach, describe, expect, it, vi } from "vitest";
import { redirect } from "next/navigation";

const auth = vi.hoisted(() => vi.fn());
const pdf = vi.hoisted(() => vi.fn());
vi.mock("@/server/auth/session", () => ({ requireIdentity: auth }));
vi.mock("@/server/pdf/service", () => ({ getPdfForReport: pdf }));
import { GET } from "@/app/api/reports/[reportId]/pdf/route";

const reportId = "6e14e7cd-a025-4420-a912-cbcafaab0c76";
const request = () => GET(new Request(`https://example.invalid/api/reports/${reportId}/pdf`), {
  params: Promise.resolve({ reportId }),
});

describe("PDF download authentication responses", () => {
  beforeEach(() => { vi.resetAllMocks(); });

  it.each(["/ru/login", "/ru/verify-email", "/ru/mfa"])("preserves the existing %s auth redirect without reading PDF data", async (destination) => {
    auth.mockImplementation(async () => redirect(destination));
    await expect(request()).rejects.toMatchObject({ digest: expect.stringContaining(`;${destination};307;`) });
    expect(pdf).not.toHaveBeenCalled();
  });

  it.each([
    ["pdf_access_denied", 403, "access_denied"],
    ["pdf_artifact_not_ready", 409, "pdf_not_ready"],
  ])("keeps the authenticated %s response", async (code, status, error) => {
    auth.mockResolvedValue({ user: { id: "fixture-user" } });
    pdf.mockRejectedValue(new Error(String(code)));
    const response = await request();
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error });
  });

  it("returns the stored PDF only after authentication", async () => {
    auth.mockResolvedValue({ user: { id: "fixture-user" } });
    pdf.mockResolvedValue({ bytes: Buffer.from("%PDF-1.7"), fileName: "report.pdf" });
    const response = await request();
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(pdf).toHaveBeenCalledWith(reportId, "fixture-user");
    expect(await response.text()).toBe("%PDF-1.7");
  });
});
