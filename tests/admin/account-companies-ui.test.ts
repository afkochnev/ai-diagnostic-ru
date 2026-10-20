import {beforeEach,describe,expect,it,vi} from "vitest";
import {renderToStaticMarkup} from "react-dom/server";
const state=vi.hoisted(()=>({memberships:[] as Record<string,unknown>[],rows:[] as {id:string;name:string;account_id:string;created_at:string}[]}));
vi.mock("server-only",()=>({}));
vi.mock("next/navigation",()=>({notFound:()=>{throw Error("not-found");}}));
vi.mock("@/server/admin/console",()=>({adminDetail:async()=>({item:{id:"user-a",name:"Owner",email:"owner@example.test",created_at:"2026-01-01",companies:state.rows.length},memberships:state.memberships,participation_statuses:[]}),adminList:async()=>({rows:state.rows,filters:{user:"user-a",page:1},page:1,total:state.rows.length,totalPages:1})}));
vi.mock("@/features/admin/plan-form",()=>({AdminPlanForm:()=>null}));
import {AdminEntityPage,AdminListPage} from "@/features/admin/console-pages";
beforeEach(()=>{state.rows=[];state.memberships=[];});
describe("administrator membership-based company navigation",()=>{
 it("links the user to paginated reachable companies and individual creator history",async()=>{const html=renderToStaticMarkup(await AdminEntityPage({section:"users",id:"user-a"}));expect(html).toContain("/ru/admin/companies?user=user-a");expect(html).toContain("/ru/admin/diagnostics?user=user-a&amp;type=individual");expect(html).toContain("Ответы и персональные оценки недоступны");});
 it("shows every returned company with explicit detail and Account links",async()=>{state.rows=[{id:"company-a",name:"Company A",account_id:"account-a",created_at:"2026-01-01"},{id:"company-b",name:"Company B",account_id:"account-a",created_at:"2026-01-01"}];const html=renderToStaticMarkup(await AdminListPage({section:"companies",searchParams:Promise.resolve({user:"user-a"})}));for(const id of ["company-a","company-b"])expect(html).toContain("/ru/admin/companies/"+id);expect(html).toContain("/ru/admin/accounts/account-a");expect(html).toContain("Company A");expect(html).toContain("Company B");});
 it("has an explicit empty state and retains user scope in its form",async()=>{const html=renderToStaticMarkup(await AdminListPage({section:"companies",searchParams:Promise.resolve({user:"user-a"})}));expect(html).toContain("ничего не найдено");expect(html).toContain('name="user"');expect(html).toContain('value="user-a"');});
});
