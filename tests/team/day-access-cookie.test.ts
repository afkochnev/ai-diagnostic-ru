import {beforeEach,describe,expect,it,vi} from "vitest";
const storage=vi.hoisted(()=>new Map<string,string>());
vi.mock("server-only",()=>({}));
vi.mock("next/headers",()=>({cookies:async()=>({getAll:()=>[...storage].map(([name,value])=>({name,value})),set:(name:string,value:string)=>storage.set(name,value)})}));
vi.mock("@/server/supabase/config",()=>({authConfig:()=>({SUPABASE_URL:"https://unit-test.supabase.co",SUPABASE_PUBLISHABLE_KEY:"synthetic-publishable",secure:true})}));
import {createAuthClient} from "@/server/supabase/server";
beforeEach(()=>storage.clear());
describe("day invitation session persistence",()=>{
 it("retains the actual SSR SDK session cookies after verification even when finalization fails",async()=>{
  const user={id:"10000000-0000-4000-8000-000000000001",email:"recipient@example.test",email_confirmed_at:"2026-11-01T00:00:00Z",aud:"authenticated",role:"authenticated",app_metadata:{},user_metadata:{},created_at:"2026-11-01T00:00:00Z"};
  const encode=(value:unknown)=>Buffer.from(JSON.stringify(value)).toString("base64url");
  const token=[encode({alg:"HS256",typ:"JWT"}),encode({sub:user.id,exp:Math.floor(Date.now()/1000)+3600,role:"authenticated"}),"synthetic-signature"].join(".");
  const request=vi.fn(async(input:RequestInfo|URL)=>{
   const url=String(input);
   if(url.includes("/auth/v1/verify"))return Response.json({access_token:token,refresh_token:"synthetic-refresh",expires_in:3600,token_type:"bearer",user});
   if(url.includes("/auth/v1/user"))return Response.json(user);
   if(url.includes("/rest/v1/rpc/finalize_team_invitation_identity"))return Response.json({message:"temporary local fixture",code:"XX000"},{status:500});
   throw Error("Unexpected local-only request");
  });
  const client=await createAuthClient(request);
  const absent=await client.auth.getUser();expect(absent.data.user).toBeNull();expect(absent.error?.name).toBe("AuthSessionMissingError");
  const verified=await client.auth.verifyOtp({token_hash:"synthetic-token-hash",type:"magiclink"});
  expect(verified.error).toBeNull();expect([...storage.keys()].some(name=>name.includes("auth-token"))).toBe(true);
  const result=await(client as unknown as{rpc:(name:string,args:object)=>Promise<{error:unknown}>}).rpc("finalize_team_invitation_identity",{});
  expect(result.error).toBeTruthy();
  const retryClient=await createAuthClient(request),current=await retryClient.auth.getUser();
  expect(current.error).toBeNull();expect(current.data.user?.email).toBe(user.email);
  expect(request.mock.calls.filter(([input])=>String(input).includes("/auth/v1/verify"))).toHaveLength(1);
 });
});
