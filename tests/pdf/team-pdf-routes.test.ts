import { beforeEach,describe,expect,it,vi } from "vitest";
const deps=vi.hoisted(()=>({identity:vi.fn(),get:vi.fn(),prepare:vi.fn()}));
vi.mock("@/server/auth/session",()=>({getIdentity:deps.identity}));
vi.mock("@/server/team/pdf-service",()=>({getTeamPdf:deps.get,prepareTeamPdf:deps.prepare}));
vi.mock("@/server/rate-limit",()=>({enforceRateLimit:vi.fn(),RateLimitExceeded:class extends Error {}}));
import { GET } from "@/app/api/team-reports/[reportId]/pdf/route";
import { POST } from "@/app/api/team-reports/[reportId]/pdf/prepare/route";
const params={params:Promise.resolve({reportId:"10000000-0000-4000-8000-000000000001"})};
beforeEach(()=>{vi.clearAllMocks();deps.identity.mockResolvedValue(null);});
describe("Team PDF HTTP boundary",()=>{
  it("anonymous GET/POST denied without a service call or redirect",async()=>{
    expect((await GET(new Request("https://example.test/api/team-reports/id/pdf"),params)).status).toBe(401);
    expect((await POST(new Request("https://example.test/api/team-reports/id/pdf/prepare",{method:"POST"}),params)).status).toBe(401);
    expect(deps.get).not.toHaveBeenCalled();expect(deps.prepare).not.toHaveBeenCalled();
  });
  it("GET serves ready bytes only; not-ready returns 409 without preparing",async()=>{
    deps.identity.mockResolvedValue({user:{id:"owner",email_confirmed_at:"date"}});deps.get.mockRejectedValueOnce(new Error("team_pdf_not_ready"));
    expect((await GET(new Request("https://example.test"),params)).status).toBe(409);expect(deps.prepare).not.toHaveBeenCalled();
    deps.get.mockResolvedValueOnce({bytes:Buffer.from("%PDF"),fileName:"team.pdf"});const response=await GET(new Request("https://example.test"),params);expect(response.headers.get("content-type")).toBe("application/pdf");expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it("cross-origin POST denied before authentication or mutation",async()=>{
    expect((await POST(new Request("https://example.test/api/prepare",{method:"POST",headers:{origin:"https://foreign.test"}}),params)).status).toBe(403);expect(deps.identity).not.toHaveBeenCalled();expect(deps.prepare).not.toHaveBeenCalled();
  });
});
