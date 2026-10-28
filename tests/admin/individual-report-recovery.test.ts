import {beforeEach,describe,expect,it,vi} from "vitest";
const m=vi.hoisted(()=>({admin:vi.fn(),core:vi.fn(),limit:vi.fn(),from:vi.fn(),row:vi.fn()}));
vi.mock("server-only",()=>({}));
vi.mock("@/server/auth/admin",()=>({requireAdmin:m.admin}));
vi.mock("@/server/ai/regeneration",()=>({requestNextAIReportVersion:m.core}));
vi.mock("@/server/rate-limit",()=>({enforceRateLimit:m.limit,RateLimitExceeded:class extends Error{retryAfter=60;}}));
vi.mock("@/server/supabase/admin",()=>({createAdminClient:()=>({from:m.from})}));
import {GET,POST} from "@/app/api/admin/diagnostics/[diagnosticId]/reports/route";
import {RateLimitExceeded} from "@/server/rate-limit";
const id="10000000-0000-4000-8000-000000000001";
const ctx=(diagnosticId=id)=>({params:Promise.resolve({diagnosticId})});
beforeEach(()=>{vi.clearAllMocks();m.admin.mockResolvedValue({user:{id:"live-admin"}});m.limit.mockResolvedValue(undefined);m.core.mockResolvedValue({id:"v2",version:2,status:"queued",input_snapshot:{secret:true}});const q={select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),order:vi.fn().mockReturnThis(),limit:vi.fn().mockReturnThis(),maybeSingle:m.row};m.from.mockReturnValue(q);m.row.mockResolvedValue({data:{id:"v1",version:1,status:"failed",error_code:"401 sk-secret provider body",input_snapshot:{raw:true}},error:null});});
describe("independent live-admin report recovery boundary",()=>{
 it("administrator enqueues foreign diagnostic with no caller identity arguments",async()=>{
  const r=await POST(new Request('https://app.test/api/admin',{method:'POST',body:JSON.stringify({userId:"forged",accountId:"forged"})}),ctx());
  expect(r.status).toBe(202);expect(m.core).toHaveBeenCalledExactlyOnceWith(id);expect(m.limit).toHaveBeenCalledWith("admin-ai-regeneration:user:live-admin",3,86400);expect(await r.json()).toEqual({id:"v2",version:2,status:"queued"});
 });
 it.each([GET,POST])("denies ordinary/revoked caller before reads or writes",async route=>{
  m.admin.mockRejectedValue(Error("redirect:/ru/access-denied"));await expect(route(new Request('https://app.test'),ctx())).rejects.toThrow('access-denied');expect(m.from).not.toHaveBeenCalled();expect(m.core).not.toHaveBeenCalled();expect(m.limit).not.toHaveBeenCalled();
 });
 it.each([GET,POST])("rejects invalid UUID",async route=>{const r=await route(new Request('https://app.test'),ctx("invalid"));expect(r.status).toBe(404);expect(m.core).not.toHaveBeenCalled();expect(m.from).not.toHaveBeenCalled();});
 it("GET exposes only safe terminal status",async()=>{const r=await GET(new Request('https://app.test'),ctx());expect(await r.json()).toEqual({id:"v1",version:1,status:"failed",error_class:"AI_REPORT_FAILED"});expect(r.headers.get('Cache-Control')).toContain('no-store');});
 it("rate limit denies before enqueue",async()=>{m.limit.mockRejectedValue(new RateLimitExceeded(60));expect((await POST(new Request('https://app.test'),ctx())).status).toBe(429);expect(m.core).not.toHaveBeenCalled();});
 it("incomplete/missing result maps to not_found",async()=>{m.core.mockRejectedValue(Error("not_found"));expect((await POST(new Request('https://app.test'),ctx())).status).toBe(404);});
 it("provider/database exception material never reaches response",async()=>{m.core.mockRejectedValue(Error("sk-secret raw provider error"));const r=await POST(new Request('https://app.test'),ctx());expect(r.status).toBe(503);expect(await r.text()).toBe('{"error":"report_regeneration_unavailable"}');});
});
