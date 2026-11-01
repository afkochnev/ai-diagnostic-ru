import type {ReactElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {beforeEach,describe,expect,it,vi} from "vitest";
const state=vi.hoisted(()=>({values:[] as unknown[],index:0,result:{success:"Проверьте почту"} as {success?:string;error?:string},pending:false}));
vi.mock("react",async original=>({...await original<typeof import("react")>(),
  useActionState:()=>[state.result,vi.fn(),state.pending],useEffect:vi.fn(),
  useState:(initial:unknown)=>{const index=state.index++;if(!(index in state.values))state.values[index]=initial;return[state.values[index],(value:unknown)=>{state.values[index]=value;}];},
}));
import {AuthForm} from "@/features/auth/auth-form";
const action=async()=>({});
function form(){state.index=0;return AuthForm({mode:"forgot",action}) as ReactElement<{onChange:()=>void}>;}
beforeEach(()=>{state.values=[];state.index=0;state.result={success:"Проверьте почту"};state.pending=false;});
describe("email form feedback",()=>{
  it("hides the previous request's success when the user edits the email for another account",()=>{
    const initial=form();expect(renderToStaticMarkup(initial)).toContain("Проверьте почту");
    initial.props.onChange();expect(renderToStaticMarkup(form())).not.toContain("Проверьте почту");
  });
  it("does not keep an earlier response visible while a new request is pending",()=>{
    state.pending=true;expect(renderToStaticMarkup(form())).not.toContain("Проверьте почту");
  });
});
