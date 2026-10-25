import {createHash} from 'node:crypto';
import {CAPTURE_TABLES} from './capture-queries';
import {FIXED,PARTICIPANTS,OLD_EFFECTS,assertData,digest,need} from './contract';
import {evidenceKeyContext,EVIDENCE_KEY_ALGORITHM,type EvidenceKeyContext} from '../../src/server/team/evidence-channel-key';
export const COHORT=Object.freeze([
 {participantId:PARTICIPANTS[0],userId:'b7cc06c7-056c-4fd8-b445-eeaf187cec7c'},
 {participantId:PARTICIPANTS[1],userId:'6041e8a9-5df5-497d-b4d2-43605a75ae43'},
 {participantId:PARTICIPANTS[2],userId:'cb133a51-dc91-488b-8fc5-31e0b76ee569'}
]);
export type Checkpoint={kind:'exact'|'prepare'|'arm'|'stop'|'grant-advanced'|'restore-free'|'aggregate'|'request-report'|'report'|'pdf'|'terminalize-aggregate'|'terminalize-report'|'closure'}|{kind:'access'|'verify-finalize'|'answers';participantId:string};
export type PreservationScope={rootId:string;windowId:string|null;teamId:string;accountId:string;planSHA256:string;expectedSHA:string;operationStartedAt:string;operationFinishedAt:string;clockSkewSeconds:0|2;clockPolicyApproved:boolean;expectedAnswersHMAC?:string;expectedSourceFingerprint?:string;expectedJobId?:string;expectedReportId?:string;expectedSubscriptionId?:string;expectedPDFChecksum?:string;expectedFixtureCommitmentSHA256?:string;expectedRevision?:number;expectedAnswersCount?:number;submitAnswers?:boolean};
export type CaptureRow={key:string;full:string;fields:Record<string,string>;facts:Record<string,unknown>|null};
export type CaptureTable={columns:string[];rows:CaptureRow[]};
export type PreservationSnapshot={format:'ACA_W2_PRESERVATION_HMAC_V2';algorithm:typeof EVIDENCE_KEY_ALGORITHM;context:EvidenceKeyContext;capturedAt:string;databaseClock:string;transactionReadOnly:'on';timezone:'UTC';project:string|null;tables:Record<string,CaptureTable>;catalogue:string;ledger:{count:number;digest:string};gates:{launch:number;financial:number};wireTraces:Record<string,unknown>[]};
export type PreservationResult=Readonly<{status:'PASS'|'HOLD';checkpoint:string;beforeSHA256:string;afterSHA256:string;checks:number;violations:readonly string[];evidenceSHA256:string}>;
const HEX=/^[a-f0-9]{64}$/;
const AUTH_USER_COLUMNS='id aud role email phone created_at deleted_at invited_at updated_at instance_id is_sso_user banned_until confirmed_at email_change is_anonymous phone_change is_super_admin recovery_token last_sign_in_at recovery_sent_at raw_app_meta_data confirmation_token email_confirmed_at encrypted_password phone_change_token phone_confirmed_at raw_user_meta_data confirmation_sent_at email_change_sent_at phone_change_sent_at email_change_token_new reauthentication_token reauthentication_sent_at email_change_token_current email_change_confirm_status'.split(' ');
const TRACE_COLUMNS='id root_run_id window_id participant_id user_id operation effect_id verification_id credential_source_trace_id approved_plan_hash status reserved_at deadline_at prewire_credential_match credential_match dispatched_at received_at http_status response_identity_matches finished_at'.split(' ');
function instant(v:unknown){return typeof v==='string'&&Number.isFinite(Date.parse(v))&&/(?:Z|\+00(?::00)?)$/.test(v);}
export function preservationContext(binding:{rootId:string;planSHA256:string;expectedSHA:string}):EvidenceKeyContext{return evidenceKeyContext({domain:'aca-w2-evidence-key',version:1,rootRunId:binding.rootId,approvedPlanSHA256:binding.planSHA256,canonicalAppSHA:binding.expectedSHA});}
function validateCapture(raw:unknown,expectedContext:EvidenceKeyContext,branch:'production'|'accepted-staging'):PreservationSnapshot{
 assertData(expectedContext);const context=evidenceKeyContext(expectedContext);need(context.rootRunId===FIXED.root,'preservation_context_root');
 assertData(raw);need(raw&&typeof raw==='object'&&!Array.isArray(raw),'preservation_snapshot');const s=raw as PreservationSnapshot;
 need(Object.keys(s).sort().join('|')===['format','algorithm','context','capturedAt','databaseClock','transactionReadOnly','timezone','project','tables','catalogue','ledger','gates','wireTraces'].sort().join('|'),'preservation_envelope');
 need(s.format==='ACA_W2_PRESERVATION_HMAC_V2'&&s.algorithm===EVIDENCE_KEY_ALGORITHM&&digest(s.context)===digest(context)&&s.project===(branch==='production'?FIXED.project:null)&&s.transactionReadOnly==='on'&&s.timezone==='UTC'&&instant(s.capturedAt)&&instant(s.databaseClock)&&HEX.test(s.catalogue),'preservation_capture_binding');
 need(s.tables&&Object.keys(s.tables).sort().join('|')===[...CAPTURE_TABLES].sort().join('|'),'preservation_complete_table_inventory');
 for(const t of Object.values(s.tables)){need(t&&Object.keys(t).sort().join('|')==='columns|rows'&&Array.isArray(t.columns)&&t.columns.length>0&&new Set(t.columns).size===t.columns.length&&t.columns.every(c=>/^[a-z_][a-z0-9_]*$/.test(c))&&Array.isArray(t.rows),'preservation_table');const keys=new Set<string>();for(const r of t.rows){need(Object.keys(r).sort().join('|')==='facts|fields|full|key'&&HEX.test(r.key)&&HEX.test(r.full)&&!keys.has(r.key),'preservation_row');keys.add(r.key);need(Object.keys(r.fields).sort().join('|')===[...t.columns].sort().join('|')&&Object.values(r.fields).every(h=>HEX.test(h))&&(r.facts===null||typeof r.facts==='object'&&!Array.isArray(r.facts)),'preservation_all_fields');}}
 need(AUTH_USER_COLUMNS.every(k=>s.tables['auth.users'].columns.includes(k))&&'id email user_id provider created_at updated_at provider_id identity_data last_sign_in_at'.split(' ').every(k=>s.tables['auth.identities'].columns.includes(k)),'preservation_auth_security_columns');
 need(s.ledger&&Object.keys(s.ledger).sort().join('|')==='count|digest'&&Number.isSafeInteger(s.ledger.count)&&s.ledger.count===57&&HEX.test(s.ledger.digest),'preservation_ledger');
 need(s.gates&&Object.keys(s.gates).sort().join('|')==='financial|launch'&&s.gates.launch===(branch==='production'?0:1)&&s.gates.financial===0&&Array.isArray(s.wireTraces),'preservation_closed_gates');
 need(new Set(s.wireTraces.map(t=>t.id)).size===s.wireTraces.length,'preservation_unique_private_traces');
 for(const t of s.wireTraces)need(Object.keys(t).sort().join('|')===[...TRACE_COLUMNS].sort().join('|')&&t.root_run_id===FIXED.root&&COHORT.some(p=>p.participantId===t.participant_id&&p.userId===t.user_id)&&['issue','verify'].includes(String(t.operation)),'preservation_private_trace_shape');
 if(branch==='accepted-staging'){need(s.wireTraces.length===0&&s.tables['private.controlled_team_policy'].rows.length===1&&['private.controlled_team_runs','private.controlled_team_effects','private.controlled_team_windows','private.controlled_team_verifications','private.controlled_team_auth_wire'].every(t=>s.tables[t].rows.length===0),'preservation_unconfigured_stage_scope');}return s;
}
export function validateSnapshot(raw:unknown,expectedContext:EvidenceKeyContext):PreservationSnapshot{return validateCapture(raw,expectedContext,'production');}
/** Stage origin/service identity is proved by the fixed transport separately;
 * project:null never grants production or W2 authority. No fixture is inserted. */
export function validateAcceptedStageSnapshot(raw:unknown,expectedContext:EvidenceKeyContext):PreservationSnapshot{return validateCapture(raw,expectedContext,'accepted-staging');}
function semanticFingerprint(s:PreservationSnapshot):string{return digest(Object.fromEntries(Object.entries(s).filter(([k])=>k!=='capturedAt'&&k!=='databaseClock')));}
export function captureFingerprint(raw:unknown,expectedContext:EvidenceKeyContext):string{return semanticFingerprint(validateSnapshot(raw,expectedContext));}
export function acceptedStageCaptureFingerprint(raw:unknown,expectedContext:EvidenceKeyContext):string{return semanticFingerprint(validateAcceptedStageSnapshot(raw,expectedContext));}
export function compareAcceptedStageSnapshots(before:unknown,after:unknown,expectedContext:EvidenceKeyContext){const b=validateAcceptedStageSnapshot(before,expectedContext),a=validateAcceptedStageSnapshot(after,expectedContext);need(Date.parse(a.capturedAt)>=Date.parse(b.capturedAt)&&Date.parse(a.databaseClock)>=Date.parse(b.databaseClock),'preservation_stage_capture_chronology');const beforeSHA256=semanticFingerprint(b),afterSHA256=semanticFingerprint(a);need(beforeSHA256===afterSHA256,'preservation_stage_full_capture_exact');return Object.freeze({status:'PASS' as const,format:b.format,algorithm:b.algorithm,context:b.context,beforeSHA256,afterSHA256,observationEnvelopeExclusions:Object.freeze(['capturedAt','databaseClock']),productionOrW2Authorization:false});}
type Facts=Record<string,unknown>;
const facts=(r:CaptureRow|undefined):Facts=>r?.facts??{};
const fieldChanges=(x:CaptureRow,y:CaptureRow)=>Object.keys(x.fields).filter(k=>x.fields[k]!==y.fields[k]);
const same=(a:unknown,b:unknown)=>digest(a)===digest(b);
const JOB_FIELDS=['status','attempts','lease_token','lease_expires_at','started_at','completed_at','last_error_code','last_error_message'];
const ADMIN='dea5f776-1923-4e8d-9042-d3ffbb1d8833';
/** Every mutated/deleted/added row must be claimed by one finite source rule.
 * Unrelated rows, old Auth sessions, legal history and the stopped W1 root have
 * no exception, including timestamps. This is preservation, not authorization. */
export function consumeSnapshot(before:unknown,current:unknown,checkpoint:Checkpoint,scope:PreservationScope):PreservationResult{
 let checks=0;const violations:string[]=[];let b:PreservationSnapshot,a:PreservationSnapshot;
 let expectedContext:EvidenceKeyContext;
 try{expectedContext=preservationContext({rootId:scope.rootId,planSHA256:scope.planSHA256,expectedSHA:scope.expectedSHA});b=validateSnapshot(before,expectedContext);a=validateSnapshot(current,expectedContext);}catch{return Object.freeze({status:'HOLD',checkpoint:checkpoint.kind,beforeSHA256:digest({invalid:true}),afterSHA256:digest({invalid:true}),checks,violations:Object.freeze(['invalid_full_capture']),evidenceSHA256:digest({checkpoint,invalid:true})});}
 const check=(v:unknown,c:string)=>{checks++;if(!v)violations.push(c);};
 check(scope.rootId===FIXED.root&&scope.teamId===FIXED.team&&scope.accountId===FIXED.account&&HEX.test(scope.planSHA256)&&/^[a-f0-9]{40}$/.test(scope.expectedSHA),'fixed_scope');
 check(instant(scope.operationStartedAt)&&instant(scope.operationFinishedAt)&&Date.parse(scope.operationStartedAt)<=Date.parse(scope.operationFinishedAt),'operation_interval');
 check(scope.clockSkewSeconds===0||scope.clockSkewSeconds===2&&scope.clockPolicyApproved===true,'explicit_clock_policy');
 check(same(b.context,a.context)&&b.catalogue===a.catalogue&&same(b.ledger,a.ledger),'key_schema_ledger_exact');
 check(Date.parse(b.capturedAt)<=Date.parse(scope.operationStartedAt)&&Date.parse(scope.operationFinishedAt)<=Math.max(Date.parse(a.capturedAt),Date.parse(a.databaseClock)),'causal_full_capture_brackets');
 const lo=Date.parse(scope.operationStartedAt)-scope.clockSkewSeconds*1000,hi=Date.parse(scope.operationFinishedAt)+scope.clockSkewSeconds*1000;
 const inTime=(v:unknown)=>instant(v)&&Date.parse(v as string)>=lo&&Date.parse(v as string)<=hi;
 const rows=(table:string,side:'before'|'after'='after')=>(side==='before'?b:a).tables[table]?.rows??[];
 const added=(t:string)=>rows(t).filter(r=>!rows(t,'before').some(x=>x.key===r.key));
 const removed=(t:string)=>rows(t,'before').filter(r=>!rows(t).some(x=>x.key===r.key));
 const claimed=new Set<string>();
 const claim=(t:string,k:string)=>{check(!claimed.has(t+':'+k),'duplicate_rule:'+t);claimed.add(t+':'+k);};
 const add=(t:string,p:(f:Facts,r:CaptureRow)=>boolean,count:number|readonly[number,number])=>{const list=added(t);const range=typeof count==='number'?[count,count]:count;check(list.length>=range[0]&&list.length<=range[1],'addition_count:'+t);for(const r of list){check(p(facts(r),r),'new_row_contract:'+t);claim(t,r.key);}return list;};
 const del=(t:string,p:(f:Facts,r:CaptureRow)=>boolean,count:readonly[number,number])=>{const list=removed(t);check(list.length>=count[0]&&list.length<=count[1],'deletion_count:'+t);for(const r of list){check(p(facts(r),r),'removed_row_contract:'+t);claim(t,r.key);}return list;};
 const mutate=(t:string,p:(f:Facts)=>boolean,allowed:readonly string[],verify:(x:Facts,y:Facts,old:CaptureRow,next:CaptureRow)=>boolean)=>{
  const old=rows(t,'before').filter(r=>p(facts(r))),next=rows(t).filter(r=>p(facts(r)));check(old.length===1&&next.length===1,'exact_target_row:'+t);if(old.length!==1||next.length!==1)return undefined;
  const x=old[0],y=next[0];check(x.key===y.key,'target_pk_exact:'+t);const changed=fieldChanges(x,y);check(changed.every(k=>allowed.includes(k))&&changed.length>0,'finite_changed_fields:'+t);check(verify(facts(x),facts(y),x,y),'target_transition:'+t);claim(t,x.key);return y;
 };
 const windowPredicate=(f:Facts)=>f.id===scope.windowId&&f.root_run_id===FIXED.root;
 const windowRow=(side:'before'|'after'='after')=>rows('private.controlled_team_windows',side).find(r=>windowPredicate(facts(r)));
 const windowBound=(f:Facts)=>windowPredicate(f)&&f.approved_plan_hash===scope.planSHA256;
 const target=(f:Facts)=>f.team_diagnostic_id===FIXED.team;
 const kind=checkpoint.kind;
 const cohort='participantId' in checkpoint?COHORT.find(p=>p.participantId===checkpoint.participantId):undefined;
 if('participantId' in checkpoint)check(cohort!==undefined,'fixed_participant');
 const effectScope=(f:Facts)=>f.run_id===FIXED.root&&f.window_id===scope.windowId;
 const effectSuccess=(f:Facts)=>effectScope(f)&&f.status==='succeeded'&&inTime(f.reserved_at)&&inTime(f.completed_at);
 const leaseFree=(f:Facts)=>f.leaseEmpty===true;
 const sourceBound=(f:Facts)=>HEX.test(String(f.source_fingerprint))&&f.source_fingerprint===scope.expectedSourceFingerprint;
 const newJob=(f:Facts,k:string)=>f.kind===k&&target(f)&&f.controlled_run_id===FIXED.root&&f.controlled_window_id===scope.windowId&&sourceBound(f)&&f.status==='queued'&&f.attempts===0&&leaseFree(f)&&f.last_error_code===null&&f.last_error_message_empty===true&&f.started_at===null&&f.completed_at===null&&inTime(f.available_at)&&inTime(f.created_at)&&(k==='team_ai_report'?f.pipeline_version==='TEAM-RU-3'&&f.provider_mode==='openai':f.pipeline_version===null&&f.provider_mode===null);
 const windowMutation=(allowed:string[],verify:(x:Facts,y:Facts)=>boolean)=>mutate('private.controlled_team_windows',windowPredicate,allowed,(x,y)=>windowBound(x)&&windowBound(y)&&verify(x,y));
 if(kind==='prepare'){
  const prior=rows('private.controlled_team_effects','before').filter(r=>facts(r).run_id===FIXED.root);check(prior.length===6&&prior.every(r=>(OLD_EFFECTS as readonly unknown[]).includes(facts(r).id)&&facts(r).status==='succeeded'&&facts(r).window_id===null),'original_six_spent_no_reset');
  check(scope.windowId!==null&&rows('private.controlled_team_windows','before').length===0,'unallocated_window');
  add('private.controlled_team_windows',f=>windowBound(f)&&f.status==='prepared'&&f.armed_at===null&&f.expires_at===null&&f.personal_deadline_at===null&&f.grant_subscription_id===null&&f.restored_subscription_id===null&&f.report_id===null&&f.source_fingerprint===null&&f.expected_subscription_id===FIXED.freeSubscription&&inTime(f.created_at),1);
 }else if(kind==='arm'){
  windowMutation(['status','armed_at','expires_at','personal_deadline_at'],(x,y)=>x.status==='prepared'&&x.armed_at===null&&y.status==='active'&&inTime(y.armed_at)&&Date.parse(String(y.expires_at))-Date.parse(String(y.armed_at))===3600000&&Date.parse(String(y.personal_deadline_at))-Date.parse(String(y.armed_at))===1200000);
 }else if(kind==='stop'){
  const f=facts(windowRow('before'));if(f.status!=='stopped')windowMutation(['status','stopped_at','stop_reason'],(x,y)=>['prepared','active'].includes(String(x.status))&&y.status==='stopped'&&x.stopped_at===null&&inTime(y.stopped_at)&&/^[a-z0-9_]{3,80}$/.test(String(y.stop_reason)));
 }else if(kind==='grant-advanced'||kind==='restore-free'){
  const granting=kind==='grant-advanced',oldPlan=granting?'free':'advanced',newPlan=granting?'advanced':'free';const wf=facts(windowRow('before'));
  check(granting?wf.status==='active'&&wf.grant_subscription_id===null:wf.status==='stopped'&&typeof wf.grant_subscription_id==='string'&&wf.restored_subscription_id===null,'manual_cas_window_stage');
  const old=mutate('private.account_subscriptions',f=>f.account_id===FIXED.account&&f.id===wf.expected_subscription_id,['status','effective_until','updated_at'],(x,y)=>x.plan_key===oldPlan&&x.status==='active'&&x.source==='manual'&&y.status==='ended'&&inTime(y.effective_until)&&inTime(y.updated_at));
  const inserted=add('private.account_subscriptions',f=>f.account_id===FIXED.account&&f.plan_key===newPlan&&f.status==='active'&&f.source==='manual'&&f.effective_until===null&&f.providerFieldsNull===true&&inTime(f.effective_from)&&inTime(f.created_at),1);
  const sid=facts(inserted[0]).id;check(typeof sid==='string'&&(!scope.expectedSubscriptionId||sid===scope.expectedSubscriptionId)&&old!==undefined,'new_manual_subscription');
  windowMutation(granting?['expected_subscription_id','grant_subscription_id']:['expected_subscription_id','restored_subscription_id'],(x,y)=>y.expected_subscription_id===sid&&(granting?y.grant_subscription_id===sid:y.restored_subscription_id===sid));
  add('private.admin_plan_changes',f=>f.account_id===FIXED.account&&f.old_plan===oldPlan&&f.new_plan===newPlan&&f.administrator_user_id===ADMIN&&f.subscription_id===sid&&f.source==='manual'&&inTime(f.created_at),1);
  add('private.audit_events',f=>f.actor_id===ADMIN&&f.subject_id===FIXED.account&&f.action==='account_plan_changed'&&inTime(f.created_at),1);
 }else if((kind==='access'||kind==='verify-finalize')&&cohort){
  const verifying=kind==='verify-finalize',uid=cohort.userId,pid=cohort.participantId;
  const traces=added('private.controlled_team_auth_wire');check(traces.length===1,'one_new_auth_trace');const trace=traces[0],tf=facts(trace);
  check(tf.root_run_id===FIXED.root&&tf.window_id===scope.windowId&&tf.participant_id===pid&&tf.user_id===uid&&tf.operation===(verifying?'verify':'issue')&&tf.approved_plan_hash===scope.planSHA256&&tf.status==='succeeded'&&tf.http_status===200&&tf.credential_match===true&&tf.response_identity_matches===true,'actual_private_wire_equality_receipt');
  check(inTime(tf.reserved_at)&&inTime(tf.dispatched_at)&&inTime(tf.received_at)&&inTime(tf.finished_at)&&Date.parse(String(tf.dispatched_at))<=Date.parse(String(tf.received_at))&&Date.parse(String(tf.received_at))-Date.parse(String(tf.dispatched_at))<=15000,'actual_wire_interval');if(trace)claim('private.controlled_team_auth_wire',trace.key);
  const wireLo=Date.parse(String(tf.dispatched_at))-scope.clockSkewSeconds*1000,wireHi=Date.parse(String(tf.received_at))+scope.clockSkewSeconds*1000;
  const wireTime=(v:unknown)=>instant(v)&&Date.parse(v as string)>=wireLo&&Date.parse(v as string)<=wireHi;
  const authAllowed=verifying?['recovery_token','email_confirmed_at','confirmed_at','last_sign_in_at','raw_user_meta_data','confirmation_token','updated_at']:['recovery_token','recovery_sent_at','updated_at'];
  mutate('auth.users',f=>f.uid===uid,authAllowed,(x,y,old,next)=>{
   const changed=fieldChanges(old,next);const common=x.emailMatchesOriginalParticipant===true&&y.emailMatchesOriginalParticipant===true&&x.providerEmailOnly===true&&y.providerEmailOnly===true&&x.metadataRestHMAC===y.metadataRestHMAC&&x.nonceHMAC===y.nonceHMAC&&x.appMetadataHMAC===y.appMetadataHMAC&&x.emailConfirmedAt===null&&x.confirmedAt===null;
   if(!verifying)return common&&changed.includes('recovery_token')&&changed.includes('recovery_sent_at')&&y.emailConfirmedAt===null&&y.confirmedAt===null&&y.recoveryTokenEmpty===false&&x.confirmationTokenEmpty===y.confirmationTokenEmpty&&x.lastSignInAt===y.lastSignInAt&&x.emailVerifiedPresent===y.emailVerifiedPresent&&x.emailVerifiedType===y.emailVerifiedType&&x.emailVerifiedBoolean===y.emailVerifiedBoolean&&wireTime(y.recoverySentAt)&&(!changed.includes('updated_at')||wireTime(y.updatedAt));
   return common&&['recovery_token','email_confirmed_at','confirmed_at','last_sign_in_at','raw_user_meta_data'].every(k=>changed.includes(k))&&x.recoveryTokenEmpty===false&&y.recoveryTokenEmpty===true&&y.confirmationTokenEmpty===true&&changed.includes('confirmation_token')===(x.confirmationTokenEmpty===false)&&x.emailVerifiedPresent===false&&x.emailVerifiedType===null&&x.emailVerifiedBoolean===null&&y.emailVerifiedPresent===true&&y.emailVerifiedType==='boolean'&&y.emailVerifiedBoolean===true&&y.confirmedAt===y.emailConfirmedAt&&wireTime(y.emailConfirmedAt)&&wireTime(y.lastSignInAt)&&(!changed.includes('updated_at')||wireTime(y.updatedAt));
  });
  const ott='auth.one_time_tokens';
  if(!verifying){del(ott,f=>f.uid===uid&&f.token_type==='recovery_token',[0,1]);add(ott,f=>f.uid===uid&&f.token_type==='recovery_token'&&f.tokenMatchesCurrentRecovery===true&&f.relatesToMatchesEmail===true&&f.expires_atNull===true&&wireTime(f.created_at)&&wireTime(f.updated_at),1);
   const effects=add('private.controlled_team_effects',f=>effectSuccess(f)&&f.participant_id===pid&&['reauth_link','access_email'].includes(String(f.effect))&&f.slot===pid,2);check(new Set(effects.map(r=>facts(r).effect)).size===2&&effects.some(r=>facts(r).effect==='reauth_link'&&facts(r).id===tf.effect_id),'issue_and_email_two_lifetime_receipts');
  }else{
   check(tf.prewire_credential_match===true&&typeof tf.credential_source_trace_id==='string','verification_exact_issuance_link');const issuance=rows('private.controlled_team_auth_wire','before').find(r=>facts(r).id===tf.credential_source_trace_id);check(issuance&&facts(issuance).operation==='issue'&&facts(issuance).status==='succeeded'&&facts(issuance).user_id===uid&&facts(issuance).participant_id===pid&&facts(issuance).window_id===scope.windowId,'prior_actual_issuance_receipt');
   const erased=del(ott,f=>f.uid===uid,[1,20]);check(erased.some(r=>facts(r).token_type==='recovery_token'&&facts(r).tokenMatchesCurrentRecovery===true),'consume_selected_issued_recovery_token');
   const sessions=add('auth.sessions',f=>f.uid===uid&&f.aal==='aal1'&&['factor_idNull','oauth_client_idNull','scopesNull','tagNull','not_afterNull','refreshed_atNull'].every(k=>f[k]===true)&&wireTime(f.created_at)&&wireTime(f.updated_at)&&((f.refresh_token_hmac_keyNull===true&&(f.refresh_token_counter===null||f.refresh_token_counter===undefined))||(f.refreshKeyNonempty===true&&f.refresh_token_counter===0)),1);const session=facts(sessions[0]);
   add('auth.refresh_tokens',f=>f.uid===uid&&f.sessionRowKey===session.sessionRowKey&&f.revoked===false&&f.parentEmpty===true&&wireTime(f.created_at)&&wireTime(f.updated_at),session.refresh_token_hmac_keyNull===true?1:0);
   add('auth.mfa_amr_claims',f=>f.uid===uid&&f.sessionRowKey===session.sessionRowKey&&f.authentication_method==='otp'&&wireTime(f.created_at)&&wireTime(f.updated_at),1);
   add('private.controlled_team_verifications',f=>f.id===tf.verification_id&&f.root_run_id===FIXED.root&&f.window_id===scope.windowId&&f.participant_id===pid&&f.user_id===uid&&inTime(f.reserved_at)&&inTime(f.finalized_at),1);
   add('public.users',f=>f.id===uid&&f.fullNameMatchesReservation===true&&f.defaultProfileFields===true&&inTime(f.created_at)&&inTime(f.updated_at),1);
   add('public.user_roles',f=>f.user_id===uid&&f.role==='user',1);
   const accounts=add('public.accounts',f=>f.legacy_origin_user_id===uid&&f.status==='active'&&f.nameMatchesUser===true&&inTime(f.created_at),1),account=facts(accounts[0]).id;
   add('public.account_memberships',f=>f.account_id===account&&f.user_id===uid&&f.role==='owner'&&f.status==='active'&&f.revoked_at===null&&inTime(f.created_at),1);
   add('private.account_subscriptions',f=>f.account_id===account&&f.status==='active'&&f.plan_key==='free'&&f.source==='system_default'&&f.effective_until===null&&f.providerFieldsNull===true&&inTime(f.created_at)&&inTime(f.effective_from),1);
   const consents=add('public.user_consents',f=>f.user_id===uid&&f.source==='team_invitation'&&f.currentApprovedVersion===true&&((f.kind==='data_processing'&&f.version==='data-processing-consent-ru-v1'&&f.granted===true)||(f.kind==='marketing'&&f.version==='marketing-consent-ru-v1'&&f.granted===false))&&inTime(f.recorded_at),2);check(new Set(consents.map(r=>facts(r).kind)).size===2,'two_distinct_current_consents');
   mutate('private.team_identity_reservations',f=>f.user_id===uid,['finalized_at'],(x,y)=>x.finalized_at===null&&inTime(y.finalized_at)&&x.invitationMatches===true&&y.invitationMatches===true);
   mutate('private.team_invitations',f=>f.participant_id===pid,['redeemed_at'],(x,y)=>x.redeemed_at===null&&inTime(y.redeemed_at));
   add('private.team_responses',f=>f.participant_id===pid&&f.user_id===uid&&f.revision===0&&f.answersEmpty===true&&f.completed_at===null,1);
   add('private.audit_events',f=>f.actor_id===null&&f.subject_id===uid&&f.action==='team_invitation_identity_finalized'&&inTime(f.created_at),1);
   rateLimit(pid,'verify');
  }
  add('auth.audit_log_entries',f=>f.uid===uid&&f.actorViaSSO===false&&f.action===(verifying?'user_signedup':'user_recovery_requested')&&wireTime(f.created_at),[0,1]);
 }else if(kind==='answers'&&cohort){
  check(HEX.test(String(scope.expectedAnswersHMAC))&&Number.isSafeInteger(scope.expectedRevision)&&Number.isSafeInteger(scope.expectedAnswersCount)&&scope.expectedAnswersCount!<=84&&scope.expectedAnswersCount!>=0&&typeof scope.submitAnswers==='boolean','bound_private_fixture_submission');
  const pid=cohort.participantId;mutate('private.team_responses',f=>f.participant_id===pid,['revision','answers','completed_at'],(x,y,_old,next)=>x.user_id===cohort.userId&&y.user_id===cohort.userId&&x.completed_at===null&&y.revision===Number(x.revision)+1&&y.revision===scope.expectedRevision&&next.fields.answers===scope.expectedAnswersHMAC&&y.answersCount===scope.expectedAnswersCount&&y.allQuestionKeysKnown===true&&(scope.submitAnswers?y.answersCount===84&&inTime(y.completed_at):y.completed_at===null));
  mutate('public.team_participants',f=>f.id===pid,['status','started_at','completed_at'],(x,y)=>['invited','started'].includes(String(x.status))&&y.status===(scope.submitAnswers?'completed':'started')&&(x.started_at===null?inTime(y.started_at):x.started_at===y.started_at)&&(scope.submitAnswers?inTime(y.completed_at):y.completed_at===null));
  rateLimit(pid,'save');
  const completed=rows('public.team_participants').filter(r=>target(facts(r))&&facts(r).status==='completed').length;
  if(scope.submitAnswers&&completed===3){check(COHORT.every(c=>rows('private.team_responses').some(r=>facts(r).participant_id===c.participantId&&facts(r).user_id===c.userId&&instant(facts(r).completed_at))&&rows('auth.users').some(r=>facts(r).uid===c.userId&&instant(facts(r).emailConfirmedAt)&&facts(r).emailMatchesOriginalParticipant===true)),'three_real_confirmed_completed_sources');add('private.team_jobs',f=>newJob(f,'team_aggregate'),1);}
 }else if(kind==='aggregate'){
  const job=finishJob('team_aggregate');check(job!==undefined,'aggregate_job');windowMutation(['aggregate_claimed'],(x,y)=>x.aggregate_claimed===false&&y.aggregate_claimed===true);
  add('public.team_results',f=>target(f)&&sourceBound(f)&&f.completed_participant_count===3&&f.overall_mean===50&&f.overall_stddev===0&&f.overall_min===50&&f.overall_max===50&&inTime(f.computed_at),1);
  add('public.team_block_results',f=>target(f)&&sourceBound(f)&&f.participant_count===3&&f.oracleMatches===true,8);
  add('public.team_question_statistics',f=>target(f)&&sourceBound(f)&&f.participant_count===3&&f.oracleMatches===true,80);
 }else if(kind==='request-report'){
  check(HEX.test(String(scope.expectedSourceFingerprint)),'exact_report_source');
  const reports=add('public.team_ai_reports',f=>target(f)&&sourceBound(f)&&f.completed_participant_count===3&&f.version===1&&f.status==='queued'&&f.contentPresent===false&&f.companyContextMatches===true&&f.pdfSnapshotMatches===true&&f.prompt_version==='TEAM-RU-3'&&f.provider_mode==='openai'&&inTime(f.created_at),1);const rid=facts(reports[0]).id;check(rid===scope.expectedReportId,'exact_requested_report');
  add('private.team_jobs',f=>newJob(f,'team_ai_report')&&f.id===scope.expectedJobId,1);windowMutation(['report_id','source_fingerprint'],(x,y)=>x.report_id===null&&y.report_id===rid&&y.source_fingerprint===scope.expectedSourceFingerprint);rateLimit(null,'results');
 }else if(kind==='report'){
  finishJob('team_ai_report');windowMutation(['ai_claimed','generation_deadline'],(x,y)=>x.ai_claimed===false&&y.ai_claimed===true&&instant(y.generation_deadline)&&Date.parse(String(y.generation_deadline))<=Date.parse(String(y.expires_at)));
  mutate('public.team_ai_reports',f=>f.id===scope.expectedReportId&&target(f),['status','structured_content','model','completed_at','error_code','prompt_version'],(x,y)=>x.status==='queued'&&y.status==='completed'&&sourceBound(x)&&sourceBound(y)&&y.completed_participant_count===3&&y.contentPresent===true&&y.validReportV3===true&&y.privacyContract===true&&y.model==='gpt-5.6-sol'&&y.prompt_version==='TEAM-RU-3'&&y.provider_mode==='openai'&&y.error_code===null&&inTime(y.completed_at));
  add('private.team_qualitative_syntheses',f=>target(f)&&sourceBound(f)&&f.completed_participant_count===3&&f.provider==='openai'&&f.model==='gpt-5.6-sol'&&f.prompt_version==='TEAM-SYNTHESIS-RU-3'&&f.summaryPresent===true&&f.validSynthesisV3===true&&f.privacyContract===true&&inTime(f.created_at),1);
  const effects=add('private.controlled_team_effects',f=>effectSuccess(f)&&f.job_id===scope.expectedJobId&&['model_get','synthesis','synthesis_repair','main_report','report_repair'].includes(String(f.effect))&&f.report_id===scope.expectedReportId,[3,5]);
  check(effects.filter(r=>facts(r).effect==='model_get').length===1&&effects.filter(r=>facts(r).effect==='synthesis').length===1&&effects.filter(r=>facts(r).effect==='main_report').length===1&&effects.filter(r=>facts(r).effect==='synthesis_repair').length<=1&&effects.filter(r=>facts(r).effect==='report_repair').length<=1,'finite_ai_stages');
  const max:Record<string,number>={model_get:0,synthesis:6000,synthesis_repair:6000,main_report:14000,report_repair:6000};check(effects.every(r=>facts(r).max_output_tokens===max[String(facts(r).effect)]&&Number.isSafeInteger(facts(r).request_bytes)&&Number(facts(r).request_bytes)>=0&&Number(facts(r).request_bytes)<=131072&&(facts(r).effect==='model_get'?facts(r).request_bytes===0:Number(facts(r).request_bytes)>0))&&effects.reduce((n,r)=>n+Number(facts(r).max_output_tokens),0)<=32000,'ai_parameter_caps_not_token_usage_claim');
 }else if(kind==='pdf'){
  check(scope.expectedPDFChecksum===undefined||HEX.test(scope.expectedPDFChecksum),'optional_observed_pdf_checksum');const artifacts=add('public.team_report_artifacts',f=>f.team_report_id===scope.expectedReportId&&f.team_report_version===1&&f.format==='pdf'&&f.template_version==='team-report-v3'&&f.status==='ready'&&f.contentPresent===true&&f.storagePathExact===true&&f.checksumMatchesContent===true&&HEX.test(String(f.checksum))&&(scope.expectedPDFChecksum===undefined||f.checksum===scope.expectedPDFChecksum)&&inTime(f.generated_at),1);
  const checksum=facts(artifacts[0]).checksum;add('private.controlled_team_effects',f=>effectSuccess(f)&&f.effect==='pdf'&&f.report_id===scope.expectedReportId&&f.providerReferenceMatchesArtifact===true,1);check(HEX.test(String(checksum)),'actual_pdf_content_checksum');
 }else if(kind==='terminalize-aggregate'||kind==='terminalize-report'){
  const k=kind==='terminalize-aggregate'?'team_aggregate':'team_ai_report';check(facts(windowRow('before')).status==='stopped','stopped_before_terminalize');
  const job=rows('private.team_jobs','before').find(r=>facts(r).id===scope.expectedJobId);if(job&&facts(job).status!=='completed'&&!(facts(job).status==='failed'&&facts(job).attempts===3))mutate('private.team_jobs',f=>f.id===scope.expectedJobId,['status','attempts','last_error_code','completed_at'],(x,y)=>x.kind===k&&leaseFree(x)&&x.status!=='running'&&y.status==='failed'&&y.attempts===3&&inTime(y.completed_at)&&/^[a-z0-9_]{3,80}$/.test(String(y.last_error_code)));
  if(k==='team_ai_report'){const r=rows('public.team_ai_reports','before').find(r=>facts(r).id===scope.expectedReportId);if(r&&facts(r).status==='queued')mutate('public.team_ai_reports',f=>f.id===scope.expectedReportId,['status','error_code'],(x,y)=>target(x)&&sourceBound(x)&&y.status==='failed'&&y.error_code==='team_processing_failed');}
 }else if(kind==='closure'){
  const wf=facts(windowRow());check(windowBound(wf)&&wf.status==='stopped'&&typeof wf.restored_subscription_id==='string'&&wf.expected_subscription_id===wf.restored_subscription_id,'closed_window_restored_free');const active=rows('private.account_subscriptions').filter(r=>facts(r).account_id===FIXED.account&&facts(r).status==='active');check(active.length===1&&facts(active[0]).id===wf.restored_subscription_id&&facts(active[0]).plan_key==='free'&&facts(active[0]).source==='manual','exact_restored_manual_free');check(rows('private.controlled_team_effects').filter(r=>facts(r).run_id===FIXED.root).every(r=>facts(r).status!=='reserved'),'no_unsettled_effect');check(rows('private.team_jobs').filter(r=>facts(r).controlled_run_id===FIXED.root).every(r=>leaseFree(facts(r))&&(facts(r).status==='completed'||facts(r).status==='failed'&&facts(r).attempts===3)),'no_target_eligible_or_leased_work');
 }else if(kind!=='exact')check(false,'unknown_checkpoint');
 function rateLimit(pid:string|null,mode:'verify'|'save'|'results'){
  const table='public.rate_limit_windows';const matches=(f:Facts)=>mode==='results'?f.rateKind==='results':f.participant_id===pid&&f.rateKind===mode;
  const seconds=mode==='verify'?600000:3600000;const bucket=(v:unknown)=>instant(v)&&[Math.floor(lo/seconds)*seconds,Math.floor(hi/seconds)*seconds].includes(Date.parse(v as string));const old=rows(table,'before').filter(r=>matches(facts(r))),list=added(table);const changed=rows(table).filter(r=>{const x=rows(table,'before').find(o=>o.key===r.key);return x&&x.full!==r.full&&matches(facts(r));});
  check(list.length+changed.length===1,'one_source_rate_limit');for(const r of list){check(matches(facts(r))&&facts(r).count===1&&bucket(facts(r).window_start),'source_new_rate_limit');claim(table,r.key);}for(const r of changed){const x=old.find(o=>o.key===r.key);check(x&&fieldChanges(x,r).every(k=>k==='count')&&Number(facts(r).count)===Number(facts(x).count)+1&&bucket(facts(r).window_start),'source_rate_limit_increment');claim(table,r.key);}
 }
 function finishJob(k:string){return mutate('private.team_jobs',f=>f.id===scope.expectedJobId,JOB_FIELDS,(x,y)=>x.kind===k&&target(x)&&target(y)&&sourceBound(x)&&sourceBound(y)&&x.controlled_run_id===FIXED.root&&x.controlled_window_id===scope.windowId&&x.status==='queued'&&x.attempts===0&&leaseFree(x)&&y.status==='completed'&&y.attempts===1&&leaseFree(y)&&y.last_error_code===null&&y.last_error_message_empty===true&&inTime(y.started_at)&&inTime(y.completed_at));}
 // Every pre-existing row and every column not explicitly accepted above stays
 // bitwise equal under the keyed capture. New/unrelated rows never disappear
 // under an aggregate/table fingerprint or an accepted timestamp exclusion.
 for(const table of CAPTURE_TABLES){check(same(b.tables[table].columns,a.tables[table].columns),'column_inventory:'+table);const old=new Map(rows(table,'before').map(r=>[r.key,r])),next=new Map(rows(table).map(r=>[r.key,r]));for(const key of new Set([...old.keys(),...next.keys()])){const x=old.get(key),y=next.get(key);if(!x||!y||!same(x,y))check(claimed.has(table+':'+key),'unexplained_row:'+table+':'+key);}}
 check(a.wireTraces.length===rows('private.controlled_team_auth_wire').filter(r=>facts(r).root_run_id===FIXED.root).length&&a.wireTraces.every(t=>rows('private.controlled_team_auth_wire').some(r=>TRACE_COLUMNS.every(k=>facts(r)[k]===t[k]))),'wire_raw_safe_projection_consistency');
 const oldTraceIds=new Set(b.wireTraces.map(t=>t.id));check(a.wireTraces.filter(t=>oldTraceIds.has(t.id)).every(t=>same(t,b.wireTraces.find(x=>x.id===t.id))),'historical_wire_traces_exact');
 check(a.wireTraces.length-b.wireTraces.length===(kind==='access'||kind==='verify-finalize'?1:0),'wire_trace_count');
 const result={status:violations.length?'HOLD' as const:'PASS' as const,checkpoint:checkpoint.kind,beforeSHA256:captureFingerprint(b,expectedContext),afterSHA256:captureFingerprint(a,expectedContext),checks,violations:Object.freeze(violations)};return Object.freeze({...result,evidenceSHA256:createHash('sha256').update(JSON.stringify(result)).digest('hex')});
}
