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

it.each(["team-report-v1","team-report-v2","team-report-v3"])("creates a percent-display artifact without returning or overwriting cached %s",async(template)=>{
 const old={team_report_id:id,format:"pdf",team_report_version:3,template_version:template,status:"ready",content_base64:Buffer.from("historical").toString("base64"),checksum:"historical-checksum"},before=JSON.stringify(old),rows:Record<string,unknown>[]=[old];
 mocks.admin.mockReturnValue({from:()=>{const filters:Record<string,unknown>={};const chain={select:()=>chain,eq:(key:string,value:unknown)=>{filters[key]=value;return chain;},maybeSingle:async()=>({data:rows.find(r=>Object.entries(filters).every(([k,v])=>r[k]===v))??null,error:null}),upsert:async(row:Record<string,unknown>,options:{ignoreDuplicates:boolean})=>{expect(options.ignoreDuplicates).toBe(true);rows.push(row);return {error:null};}};return chain;}});
 await expect(getTeamPdf(id,"owner")).rejects.toThrow("team_pdf_not_ready");await prepareTeamPdf(id,"owner");
 expect(rows).toHaveLength(2);expect(rows[1].template_version).toBe("team-report-v3-dispersion-percent-v1");expect(JSON.stringify(old)).toBe(before);expect((await getTeamPdf(id,"owner")).bytes.toString()).toContain("%PDF");
});

function profileClient(fingerprint="same",questionCount=80){
 const snapshot={...source(),overall:{mean:50,maturity:"Зона развития",stddev_pop:18.9},blocks:source().blocks.map((b,i)=>({...b,position:i+1,stddev_pop:14.3}))};
 const questions=Array.from({length:questionCount},(_,i)=>({position:i%10+1,block_position:Math.floor(i/10)+1,prompt:`Вопрос ${i+1}`,mean_score:2,stddev_score:1.247219128924647,participant_count:4}));
 const rpc=vi.fn(async(name:string)=>({data:name==="read_team_pdf_source"?snapshot:{status:"ready",fingerprint,completed_count:4,questions},error:null}));
 const chain={select:()=>chain,eq:()=>chain,single:async()=>({data:{team_diagnostic_id:id,source_fingerprint:"same"},error:null})};
 return {rpc,from:()=>chain};
}
it("attaches all 80 authorized current questions using persisted unrounded SD",async()=>{
 mocks.auth.mockResolvedValue(profileClient());await prepareTeamPdf(id,"owner");
 const profile=mocks.render.mock.calls[0][0].profile;expect(profile.questions).toHaveLength(80);expect(profile.questions[0].stddev).toBe(1.247219128924647);expect(profile.overall.stddev).toBe(18.9);
});
it("keeps frozen report aggregates without attaching questions from a changed source",async()=>{
 mocks.auth.mockResolvedValue(profileClient("changed"));await prepareTeamPdf(id,"owner");
 expect(mocks.render.mock.calls[0][0].profile).toMatchObject({overall:{stddev:18.9},questions:[]});
});
it("rejects an incomplete current appendix before rendering or writing",async()=>{
 mocks.auth.mockResolvedValue(profileClient("same",79));await expect(prepareTeamPdf(id,"owner")).rejects.toThrow("team_pdf_failed");
 expect(mocks.render).not.toHaveBeenCalled();expect(mocks.upsert).not.toHaveBeenCalled();
});
