import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
import crypto from "node:crypto";
import { reportFixture } from "../team/v3-fixtures";
const mocks=vi.hoisted(()=>({auth:vi.fn(),admin:vi.fn(),render:vi.fn(),upsert:vi.fn()}));
vi.mock("server-only",()=>({}));
vi.mock("@/server/account/authorization",()=>({authenticatedAccountClient:mocks.auth}));
vi.mock("@/server/supabase/admin",()=>({createAdminClient:mocks.admin}));
vi.mock("@/server/team/pdf-render",()=>({renderTeamPdf:mocks.render}));
import { getTeamPdf,prepareTeamPdf } from "@/server/team/pdf-service";
const id="10000000-0000-4000-8000-000000000001";
const source=()=>({report_id:id,version:3,pipeline:"TEAM-RU-3",model:"team-mock-v3",completed_at:"2026-10-19T07:00:00+00:00",company_name:"FoodTech",team_title:"Team",participant_count:4,overall:{mean:50,maturity:"Зона развития"},blocks:Array.from({length:8},(_,i)=>({title:`Блок ${i+1}`,mean:50})),content:reportFixture()});
let artifact:Record<string,string>|null=null;
beforeEach(()=>{
  vi.clearAllMocks();artifact=null;
  mocks.auth.mockResolvedValue({rpc:vi.fn(async()=>({data:source(),error:null}))});
  mocks.render.mockResolvedValue(Buffer.from("%PDF-1.7\nsynthetic"));
  mocks.upsert.mockImplementation(async(row)=>{artifact??=row;return {error:null};});
  mocks.admin.mockReturnValue({from:(table:string)=>{expect(table).toBe("team_report_artifacts");const chain={select:()=>chain,eq:()=>chain,maybeSingle:async()=>({data:artifact,error:null}),upsert:mocks.upsert};return chain;}});
});
afterEach(()=>vi.restoreAllMocks());
describe("Team PDF artifact boundary",()=>{
  it("GET not ready is read only: no rendering or writes",async()=>{
    await expect(getTeamPdf(id,"owner")).rejects.toThrow("team_pdf_not_ready");expect(mocks.render).not.toHaveBeenCalled();expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it("owner prepare/download checksum matches; repeated prepare reuses immutable artifact",async()=>{
    await expect(prepareTeamPdf(id,"owner")).resolves.toMatchObject({status:"ready"});
    const pdf=await getTeamPdf(id,"owner");expect(crypto.createHash("sha256").update(pdf.bytes).digest("hex")).toBe(artifact?.checksum);
    expect(pdf.fileName).toBe("team-management-ai-audit-foodtech-v3.pdf");await prepareTeamPdf(id,"owner");expect(mocks.render).toHaveBeenCalledOnce();expect(mocks.upsert).toHaveBeenCalledOnce();
    expect(mocks.upsert.mock.calls[0][1]).toMatchObject({ignoreDuplicates:true,onConflict:"team_report_id,format,template_version"});
  });
  it.each(["participant","foreign-account","administrator-without-membership"])("denies %s before admin artifact access",async user=>{
    mocks.auth.mockResolvedValue({rpc:async()=>({data:null,error:{message:"team_not_found"}})});
    await expect(getTeamPdf(id,user)).rejects.toThrow("team_pdf_access_denied");await expect(prepareTeamPdf(id,user)).rejects.toThrow("team_pdf_access_denied");expect(mocks.admin).not.toHaveBeenCalled();expect(mocks.render).not.toHaveBeenCalled();
  });
  it("detects damaged artifact bytes instead of serving an invalid checksum",async()=>{
    await prepareTeamPdf(id,"owner");artifact!.checksum="0".repeat(64);await expect(getTeamPdf(id,"owner")).rejects.toThrow("team_pdf_failed");
  });
  it("parallel prepare is deduplicated and each request is authorized",async()=>{
    await Promise.all([prepareTeamPdf(id,"owner"),prepareTeamPdf(id,"owner")]);expect(mocks.render).toHaveBeenCalledOnce();expect(mocks.auth.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
});
