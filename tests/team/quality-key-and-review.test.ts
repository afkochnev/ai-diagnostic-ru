import { mkdtempSync,writeFileSync,existsSync,chmodSync,rmSync,symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it,expect } from "vitest";
import { consumePrivateKey } from "@/server/team/quality/private-key";
import { blindReviewHtml } from "@/server/team/quality/blind-review";
import { authoredStageStubs } from "../../scripts/fixtures/team-quality-stage-stubs";
import { qualityCase } from "../../scripts/fixtures/team-quality-cases";
import { qualityReportSchema,flattenGroundedDraft,type GroundedDraft } from "@/server/team/quality/contracts";
it("consumes a private dummy key exactly once and refuses exposed/symlink files",()=>{
 const d=mkdtempSync(join(tmpdir(),"quality-key-test-")),p=join(d,"key.txt"),key="sk-"+"x".repeat(45);chmodSync(d,0o700);
 try{writeFileSync(p,key,{mode:0o600});expect(consumePrivateKey(p)).toBe(key);expect(existsSync(p)).toBe(false);expect(()=>consumePrivateKey(p)).toThrow();
 writeFileSync(p,key,{mode:0o644});expect(()=>consumePrivateKey(p)).toThrow("quality_private_key_guard");chmodSync(p,0o600);symlinkSync(p,join(d,"link"));expect(()=>consumePrivateKey(join(d,"link"))).toThrow("quality_private_key_guard");
 }finally{rmSync(d,{recursive:true,force:true});}
});
it("blind packaging escapes generated markup, contains all16sections and labels simulation",()=>{
 const generated=authoredStageStubs(qualityCase("production")).combined as GroundedDraft & {team_analysis:unknown}; const draft=flattenGroundedDraft(generated);
 const report=qualityReportSchema.parse({...draft.content,participant_count:4,team_analysis:generated.team_analysis});report.summary='<script>alert("x")</script>';
 const html=blindReviewHtml(report,"case-1","Учебная компания",true);expect(html.match(/<section>/g)).toHaveLength(16);expect(html).not.toContain("<script>");expect(html).toContain("&lt;script&gt;");expect(html).toContain("не результат AI");
});
