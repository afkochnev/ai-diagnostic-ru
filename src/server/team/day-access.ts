import "server-only";
import {z} from "zod";
import {createAdminClient} from "@/server-runtime/supabase/admin";
import {sealInvitationDayGrant, type InvitationDayGrant} from "./invitation-auth-proof";
import {authConfig} from "@/server/supabase/config";
import {singleEmailCredential} from "./single-email";

export async function issueInvitationDayAccess(hash:string,email:string){
 const {data,error}=await createAdminClient().rpc("team_invitation_day_access",{p_operation:"issue",p_invitation_hash:hash});
 const parsed=z.object({status:z.literal("issued"),email:z.email(),expires_at:z.iso.datetime({offset:true})}).safeParse(data);
 if(error||!parsed.success||parsed.data.email!==email)throw Error("team_invitation_unavailable");
 const expires=Date.parse(parsed.data.expires_at);
 if(expires<=Date.now()||expires>Date.now()+86400000+60000)throw Error("team_invitation_unavailable");
 return {envelope:sealInvitationDayGrant({version:2,purpose:"team-invitation-day",email,invitationHash:hash,expires},authConfig().AUTH_FLOW_SECRET),expires};
}

export async function claimInvitationDayAccess(grant:InvitationDayGrant,fetcher:typeof fetch){
 const {data,error}=await createAdminClient(fetcher).rpc("team_invitation_day_access",{p_operation:"claim",p_invitation_hash:grant.invitationHash});
 if(error)throw Error(error.message==="team_invitation_unavailable"?"team_invitation_unavailable":"team_auth_retry");
 if(data?.status==="busy")throw Error("team_auth_busy");
 if(data?.status==="rate_limited")throw Error("rate_limited");
 if(data?.status==="spent")throw Error("team_email_invalid");
 const parsed=z.object({status:z.literal("claimed"),email:z.email(),expires_at:z.iso.datetime({offset:true}),lease_until:z.iso.datetime({offset:true})}).safeParse(data);
 if(!parsed.success||parsed.data.email!==grant.email||Date.parse(parsed.data.expires_at)<grant.expires-1||Date.parse(parsed.data.lease_until)<=Date.now())throw Error("team_invitation_unavailable");
 // Only this server path sees the short-lived credential. No extra email is sent.
 let credential:Awaited<ReturnType<typeof singleEmailCredential>>;
 try{credential=await singleEmailCredential(grant.invitationHash,fetcher);}catch(error){throw Error(error instanceof Error&&error.message==="team_invitation_unavailable"?"team_invitation_unavailable":"team_auth_retry");}
 if(credential.email!==grant.email)throw Error("team_invitation_unavailable");
 return credential;
}
