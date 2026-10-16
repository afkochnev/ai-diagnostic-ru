import "server-only";
import {createHash,randomBytes} from "node:crypto";
import {z} from "zod";
import {createAdminClient} from "@/server-runtime/supabase/admin";
import {authConfig} from "@/server/supabase/config";
import {sealInvitationAuthProof} from "./invitation-auth-proof";

const targetSchema=z.object({email:z.email(),display_name:z.string().min(1).max(100),create_user:z.boolean()}).strict();
// Called only after the owner-scoped invitation RPC. Neither the generated
// credential nor Supabase's admin result may cross an owner action response.
export async function singleEmailCredential(invitationHash:string){
 const admin=createAdminClient(),nonce=randomBytes(32).toString("hex");
 const {data,error}=await admin.rpc("reserve_team_invitation_identity",{p_token_hash:invitationHash,p_nonce_hash:createHash("sha256").update(nonce).digest("hex")});
 if(error)throw new Error("team_invitation_unavailable");
 const target=targetSchema.parse(data),type=target.create_user?"invite":"magiclink";
 const generated=await admin.auth.admin.generateLink({type,email:target.email,options:{redirectTo:`${authConfig().APP_URL}/ru/team/join`,...(target.create_user?{data:{team_pending_nonce:nonce}}:{})}});
 const properties=generated.data?.properties,user=generated.data?.user;
 if(generated.error || !properties || properties.verification_type!==type || user?.email?.toLowerCase()!==target.email)throw new Error("team_auth_unavailable");
 return {email:target.email,envelope:sealInvitationAuthProof({email:target.email,invitationHash,tokenHash:properties.hashed_token,type},authConfig().AUTH_FLOW_SECRET)};
}
