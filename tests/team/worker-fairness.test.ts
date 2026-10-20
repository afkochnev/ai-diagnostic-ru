import { beforeEach, expect, it, vi } from "vitest";
const fixture=vi.hoisted(()=>({order:[] as string[],rpc:vi.fn(async(name:string)=>({data:[{job_id:name}],error:null}))}));
vi.mock("@/server-runtime/supabase/admin",()=>({createAdminClient:()=>({rpc:fixture.rpc})}));
vi.mock("@/server/scoring/worker",()=>({runScoringJob:async()=>{fixture.order.push("individual-score");}}));
vi.mock("@/server/ai/worker",()=>({runAIJob:async()=>{fixture.order.push("individual-report");}}));
vi.mock("@/server/consultation/worker",()=>({runPendingConsultationNotifications:async()=>{fixture.order.push("consultation");}}));
vi.mock("@/server/team/worker",()=>({runTeamJobs:async()=>{fixture.order.push("team");throw new Error("private details must not be logged");}}));
import { runWorkerOnce } from "@/server/worker/runner";
beforeEach(()=>{fixture.order.length=0;fixture.rpc.mockClear();});
it("services every legacy kind before a bounded Team iteration, and survives Team outage",async()=>{
 const log=vi.spyOn(console,"error").mockImplementation(()=>{});
 try{
  await expect(runWorkerOnce()).resolves.toEqual({scoring:1,ai:1});
  await expect(runWorkerOnce()).resolves.toEqual({scoring:1,ai:1});
  expect(fixture.order).toEqual(["individual-score","individual-report","consultation","team","individual-score","individual-report","consultation","team"]);
  expect(log.mock.calls.flat().join(" ")).not.toContain("private details");
 }finally{log.mockRestore();}
});
