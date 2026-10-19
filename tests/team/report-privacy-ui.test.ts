import { expect,it,vi } from "vitest";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
vi.mock("@/features/team/result-actions",()=>({TeamResultForm:({label}:{label:string})=>React.createElement('button',null,label)}));
vi.mock("@/features/team/report-progress",()=>({TeamReportProgress:()=>null}));
import { TeamResultsView } from "@/features/team/results";
vi.stubGlobal("React",React);
it("shows a readable privacy failure and retry without the technical code",()=>{
 const result={status:"ready",completed_count:3,fingerprint:"source",overall:{overall_mean:50,overall_stddev:0,overall_min:50,overall_max:50},maturity:"Зона развития",blocks:[],questions:[],reports:[{id:"report",version:2,source_fingerprint:"source",completed_participant_count:3,status:"failed",prompt_version:"TEAM-RU-3",structured_content:null,created_at:"2026-10-18",error_code:"team_privacy_rejected"}]} as Parameters<typeof TeamResultsView>[0]["result"];
 const html=renderToStaticMarkup(React.createElement(TeamResultsView,{teamId:"team",result}));expect(html).toContain("Не удалось безопасно подготовить отчёт. Можно повторить генерацию.");expect(html).not.toContain("team_privacy_rejected");expect(html).toContain("Обновить AI-отчёт");
});
