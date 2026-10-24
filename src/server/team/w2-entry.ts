import 'server-only';
import {z} from 'zod';
import {createAdminClient} from '@/server-runtime/supabase/admin';
import {controlledTeamContext} from '@/server-runtime/team-smoke';
import {openControlledTeamW2Proof} from '@/server-runtime/team-w2-proof';

/** No Auth request, nonce reset or consent is performed while opening a link. */
export async function readControlledTeamW2Entry(envelope:string|undefined,secret:string){
 const proof=openControlledTeamW2Proof(envelope,secret);
 if(!proof)throw Error('team_context_expired');
 const controlled=await controlledTeamContext({windowId:proof.windowId,participantId:proof.participantId,invitationHash:proof.invitationHash});
 if(!controlled||controlled.run_id!==proof.runId||controlled.team_id!==proof.teamId||!controlled.personal_deadline_at||Date.parse(controlled.personal_deadline_at)<=Date.now()||proof.expires>Date.parse(controlled.personal_deadline_at))throw Error('team_context_expired');
 const {data,error}=await createAdminClient().rpc('resolve_team_invitation_auth',{p_token_hash:proof.invitationHash});
 const parsed=z.object({email:z.email(),display_name:z.string().min(1).max(100),create_user:z.literal(false),user_id:z.uuid()}).safeParse(data);
 if(error||!parsed.success||parsed.data.user_id!==proof.userId||parsed.data.email!==proof.email)throw Error('team_context_expired');
 return {proof,controlled,target:parsed.data};
}
