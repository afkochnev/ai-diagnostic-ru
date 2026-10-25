import { execFileSync } from 'node:child_process';
import { readFileSync, lstatSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIXED, OLD_EFFECTS, PARTICIPANTS, WEB, assertData, assertEnvironment, bytesDigest, digest, fresh, need, type Scope, type Slot, type W2Plan } from './contract';
import { assertOwnedTransport, type FiniteTransport, type Preimage } from './capabilities';
import { assertOwnedJournal, type Journal } from './journal';
import { captureFingerprint, validateSnapshot, preservationContext } from './preservation';
export type Readiness = Readonly<{
    checkedAt: string;
    evidenceSHA256: string;
    expectedSHA: string;
    windowId: string | null;
}>;
type ServiceFacts = {
    id: string;
    environment: Record<string, string>;
    configSHA256: string;
    live: {
        id: string;
        commit: {
            id: string;
        };
        status: string;
    };
    newest: {
        id: string;
        commit: {
            id: string;
        };
        status: string;
    };
    latest: Record<string, unknown>;
    suspended: string;
    instances: Record<string, unknown>[];
    jobs: Record<string, unknown>[];
};
type Stored = {
    plan: W2Plan;
    transport: FiniteTransport;
    scope: Scope | null;
    checkedAt: string;
    observedFrom: string;
    services: ServiceFacts[];
    state: Record<string, unknown>;
    baseline: unknown;
    auth: Record<string, unknown>;
    preimage: Preimage;
    source: unknown;
    authVersion: {checkedAt:string;advertisedVersion:'v2.197.0';officialCommit:string;versionEvidenceKind:'SELF_REPORTED_HEALTH_NOT_BINARY_ATTESTATION';receiptSHA256:string};
    rawEvidence: unknown;
    verifyLocalSource: () => void;
    stop: {
        instanceId: string;
        requestedAt: string;
        acknowledgedAt: string;
        absentAt: string;
    } | null;
    idle: {
        instanceId: string;
        observedAt: string;
        checkedAt: string;
        evidenceSHA256: string;
    } | null;
    drains: Readiness[];
    journal: Journal;
};
const owned = new WeakMap<Readiness, Stored>();
function immutable<T>(value: T): T { assertData(value); const copy = structuredClone(value); function freeze(v: unknown) { if (v && typeof v === 'object') {
    for (const x of Object.values(v))
        freeze(x);
    Object.freeze(v);
} } freeze(copy); return copy; }
function safe(proof: Stored) { return immutable({ checkedAt: proof.checkedAt, observedFrom: proof.observedFrom, services: proof.services.map(s => ({ id: s.id, environmentSHA256: digest(s.environment), teamEnabled: s.environment.TEAM_ENABLED, configSHA256: s.configSHA256, live: { id: s.live.id, status: s.live.status, commit: { id: s.live.commit.id } }, newest: { id: s.newest.id, status: s.newest.status, commit: { id: s.newest.commit.id } }, suspended: s.suspended, instances: s.instances.map(i => ({ id: i.id, status: i.status, ready: i.ready })), jobs: s.jobs.map(j => ({ id: j.id, status: j.status, startedAt: j.startedAt ?? null, finishedAt: j.finishedAt ?? null })) })), state: proof.state, baseline: proof.baseline, authConfigSHA256: digest(proof.auth), authVersion: proof.authVersion, stop: proof.stop, idle: proof.idle, drains: proof.drains }); }
function rawReadiness(handle: Readiness, plan: W2Plan, scope: Scope | null, transport: FiniteTransport, now: number) { assertOwnedTransport(transport, plan); const proof = owned.get(handle); need(proof && proof.plan === plan && proof.transport === transport && handle.expectedSHA === plan.expectedSHA && handle.windowId === (scope?.windowId ?? null), 'owned_readiness'); fresh(handle.checkedAt, now); fresh(proof.observedFrom, now); proof.verifyLocalSource(); return proof; }
function expectedCurrentControls(proof: Stored) { const accepted = (s: Slot) => proof.journal.read(s, 'receipt')?.status === 'KNOWN_ACCEPTED', web = proof.services.find(x => x.id === WEB)!, warm = { ...proof.preimage.web, TEAM_ENABLED: 'true', TEAM_INVITATION_EMAIL_PROVIDER: 'resend', TEAM_AI_PROVIDER: 'openai' }, present = proof.preimage.auth.uri_allow_list.split(',').map(x => x.trim()).includes(FIXED.callback), authWarm = { ...proof.preimage.auth, uri_allow_list: present ? proof.preimage.auth.uri_allow_list : proof.preimage.auth.uri_allow_list + (proof.preimage.auth.uri_allow_list ? ',' : '') + FIXED.callback }; const environment = accepted('controls/env-restore') ? proof.preimage.web : accepted('controls/env-warm') ? warm : proof.preimage.web, auth = accepted('controls/auth-restore') ? proof.preimage.auth : accepted('controls/auth-add') ? authWarm : proof.preimage.auth; need(digest(web.environment) === digest(environment) && digest(proof.auth) === digest(auth), 'actual_stage_env_auth_preimages'); }
export type CollectorOptions = {
    preimage: Preimage;
    mode: 'PRODUCTION' | 'LOCAL_MOCK';
    localMockSource?: {
        sha: string;
        tree: string;
        manifestSHA256: string;
    };
    journal: Journal;
    drains?: readonly [
        Readiness,
        Readiness
    ];
};
function localSource(plan: W2Plan, options: CollectorOptions) { if (options.mode === 'LOCAL_MOCK') {
    need(options.localMockSource?.sha === plan.expectedSHA && options.localMockSource.tree === plan.treeSHA && options.localMockSource.manifestSHA256 === plan.sourceManifestSHA256, 'mock_source');
    return options.localMockSource;
} need(options.localMockSource === undefined, 'no_production_source_injection'); const repo = fileURLToPath(new URL('../../', import.meta.url)), git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim(); need(git('status', '--porcelain') === '' && git('rev-parse', 'HEAD') === plan.expectedSHA && git('rev-parse', 'HEAD^{tree}') === plan.treeSHA, 'local_canonical_source'); for (const [name, hash] of Object.entries(plan.sourceManifest)) {
    const path = resolve(repo, name);
    need(path.startsWith(resolve(repo) + sep), 'source_path');
    let current = repo;
    for (const part of name.split('/')) {
        current = join(current, part);
        const st = lstatSync(current);
        need(!st.isSymbolicLink(), 'source_symlink');
    }
    need(bytesDigest(readFileSync(path)) === hash, 'local_source_file');
} return { sha: plan.expectedSHA, tree: plan.treeSHA, manifestSHA256: plan.sourceManifestSHA256 }; }
function valueRows(raw: unknown) { assertData(raw); need(Array.isArray(raw) && raw.length === 1 && raw[0] && typeof raw[0] === 'object' && !Array.isArray(raw[0]), 'single_select_row'); const value = (raw[0] as {
    evidence?: unknown;
}).evidence; need(value && typeof value === 'object' && !Array.isArray(value), 'evidence_select'); return value as Record<string, unknown>; }
function unwrap(value: unknown, key: string) { assertData(value); need(Array.isArray(value), 'provider_list'); return value.map(x => { need(x && typeof x === 'object' && !Array.isArray(x), 'provider_row'); return ((x as Record<string, unknown>)[key] ?? x) as Record<string, unknown>; }); }
async function service(transport: FiniteTransport, id: string, plan: W2Plan): Promise<ServiceFacts> { const [r, e, d, j, i] = await Promise.all(['service', 'environment', 'deploys', 'jobs', 'instances'].map(k => transport.readService(id, k as 'service'))); assertData(r); need(r && typeof r === 'object' && !Array.isArray(r), 'service'); const raw = r as Record<string, unknown>; need(raw.id === id && raw.ownerId === 'tea-daipgd67bikc739jftl0' && raw.autoDeploy === 'no' && ['suspended', 'not_suspended'].includes(String(raw.suspended)), 'service_identity'); const environment = Object.fromEntries(unwrap(e, 'envVar').map(x => { need(typeof x.key === 'string' && typeof x.value === 'string', 'environment'); return [x.key, x.value]; })); need(Object.keys(environment).length === unwrap(e, 'envVar').length, 'duplicate_environment'); assertEnvironment(environment, id === WEB && environment.TEAM_ENABLED === 'true' ? 'true' : 'false'); const deploys = unwrap(d, 'deploy'); need(!deploys.some(x => ['created', 'queued', 'build_in_progress', 'pre_deploy_in_progress', 'update_in_progress'].includes(String(x.status))), 'pending_deploy'); const live = deploys.find(x => x.status === 'live'), newest = deploys.find(x => ['live', 'deactivated', 'superseded'].includes(String(x.status))); need(live && newest && (live.commit as {
    id?: unknown;
})?.id === plan.expectedSHA && (newest.commit as {
    id?: unknown;
})?.id === plan.expectedSHA, 'newest_successful_exact'); const jobs = unwrap(j, 'job'); need(jobs.every(x => x.serviceId === id && ['pending', 'running', 'succeeded', 'failed', 'canceled', 'cancelled'].includes(String(x.status))), 'unknown_oneoff'); const instances = unwrap(i, 'instance'); return { id, environment, configSHA256: digest({ id: raw.id, owner: raw.ownerId, type: raw.type, repo: raw.repo, branch: raw.branch, autoDeploy: raw.autoDeploy, rootDir: raw.rootDir ?? null, details: raw.serviceDetails ?? null }), live: live as ServiceFacts['live'], newest: newest as ServiceFacts['newest'], latest: deploys[0], suspended: String(raw.suspended), jobs, instances }; }
/** Obtain actual fixed GET/READ ONLY SELECT receipts. No critical observation is
 * accepted as an arbitrary PASS boolean. This does not perform an effect. */
export async function collectReadiness(plan: W2Plan, scope: Scope | null, transport: FiniteTransport, options: CollectorOptions): Promise<Readiness> { const observedFrom = new Date().toISOString(); assertOwnedTransport(transport, plan); assertOwnedJournal(options.journal, plan, options.mode); options = { ...options, preimage: structuredClone(options.preimage), localMockSource: options.localMockSource ? { ...options.localMockSource } : undefined, drains: options.drains ? [options.drains[0], options.drains[1]] : undefined }; need(transport.mode === options.mode || transport.mode === 'READ_ONLY', 'collector_mode'); localSource(plan, options); need(digest(options.preimage.web) === plan.preimage.webEnvSHA256 && digest(options.preimage.worker) === plan.preimage.workerEnvSHA256 && digest(options.preimage.auth) === plan.preimage.authConfigSHA256, 'approved_full_preimage'); const authVersion = await transport.readAuthVersion();
    const authCapability = await transport.checkAuthHeaderCapability(); const [source, web, worker, rawState, rawBaseline, auth] = await Promise.all([transport.readSource(), service(transport, WEB, plan), service(transport, FIXED.worker, plan), transport.readDatabase('state'), transport.readDatabase('w2_preservation_capture_v1'), transport.readAuthConfiguration()]); assertData(source); const main = source.main as {
    sha?: unknown;
    commit?: {
        tree?: {
            sha?: unknown;
        };
    };
}, checks = source.checks as {
    total_count?: number;
    check_runs?: {
        name: string;
        head_sha: string;
        status: string;
        conclusion: string;
    }[];
}; need(main.sha === plan.expectedSHA && main.commit?.tree?.sha === plan.treeSHA && typeof checks.total_count === 'number' && checks.total_count <= 100 && Array.isArray(checks.check_runs) && checks.total_count === checks.check_runs.length && ['application', 'isolated-sql'].every(n => checks.check_runs?.some(x => x.name === n && x.head_sha === plan.expectedSHA && x.status === 'completed' && x.conclusion === 'success')), 'canonical_main_ci'); const state = valueRows(rawState), baseline = validateSnapshot(rawBaseline,preservationContext(plan)); for (const s of [web, worker]) {
    const webOwned = ['controls/web-deploy-warm', 'controls/web-deploy-restore'].map(k => options.journal.read(k as Slot, 'receipt')?.providerId).filter(Boolean);
    if (s.id === WEB)
        need([plan.preimage.webDeployId, ...webOwned].includes(s.live.id) && [plan.preimage.webDeployId, ...webOwned].includes(String(s.latest.id)), 'owned_web_build');
    else {
        const resumed = options.journal.read('controls/worker-resume', 'receipt'), resumeIntent = options.journal.read('controls/worker-resume', 'intent');
        need(s.live.id === plan.preimage.workerDeployId && s.newest.id === plan.preimage.workerDeployId && s.latest.id === plan.preimage.workerDeployId || resumed?.status === 'KNOWN_ACCEPTED' && resumeIntent && s.latest.id === s.live.id && s.newest.id === s.live.id && s.latest.trigger === 'service_resumed' && typeof s.latest.createdAt === 'string' && Date.parse(s.latest.createdAt) >= Date.parse(resumeIntent.at), 'owned_worker_build');
    }
    need(s.configSHA256 === (s.id === WEB ? plan.preimage.webConfigSHA256 : plan.preimage.workerConfigSHA256), 'service_config_preserved');
    const history = [];
    for (const j of s.jobs) {
        const matches = Object.values(PARTICIPANTS).map(p => 'render/access/' + p).concat(['render/team_aggregate', 'render/team_ai_report']).map(k => options.journal.read(k as Slot, 'receipt')).filter(r => r?.providerId === j.id);
        need(matches.length <= 1, 'duplicate_owned_provider_id');
        if (matches.length) {
            need(digest({ method: 'POST', origin: 'https://api.render.com', path: `/v1/services/${s.id}/jobs`, body: { startCommand: j.startCommand, planId: j.planId } }) === matches[0]?.requestSHA256, 'owned_job_command');
        }
        else
            history.push({ id: j.id, status: j.status, serviceId: j.serviceId, planId: j.planId, startCommandSHA256: digest(String(j.startCommand)) });
    }
    need(digest(history) === (s.id === WEB ? plan.preimage.webOneoffsSHA256 : plan.preimage.workerOneoffsSHA256), 'historical_oneoffs_unchanged');
} need(state.timezone === 'UTC' || state.timezone === 'Etc/UTC', 'db_timezone'); need(state.openLaunchGates === 0 && state.openFinancialGates === 0, 'db_gates'); need((state.root as {
    id?: unknown;
    status?: unknown;
})?.id === FIXED.root && (state.root as {
    status?: unknown;
})?.status === 'stopped', 'old_root_stopped'); const old = state.oldEffects as {
    id: string;
    status: string;
    fingerprint: string;
}[]; need(Array.isArray(old) && old.length === 6 && old.every(x => (OLD_EFFECTS as readonly string[]).includes(x.id) && x.status === 'succeeded') && digest(old) === plan.oldEffectsSHA256, 'old_six_immutable'); const cohort = state.cohort as {
    id: string;
    team: string;
    expiry: string;
}[]; need(Array.isArray(cohort) && cohort.length === 3 && cohort.every(x => (PARTICIPANTS as readonly string[]).includes(x.id) && x.team === FIXED.team), 'existing_cohort'); if (scope) {
    need(scope.expectedSHA === plan.expectedSHA && scope.planSHA256 === plan.planSHA256, 'scope');
    const window = state.window as {
        id?: unknown;
        approved_plan_hash?: unknown;
    } | null;
    need(window?.id === scope.windowId && window.approved_plan_hash === plan.planSHA256, 'actual_window_readback');
}
else
    need(state.window === null, 'no_preallocated_window'); assertData(auth); need(auth && typeof auth === 'object' && !Array.isArray(auth), 'auth_config'); const preimage = structuredClone(options.preimage); let stop: Stored['stop'] = null, idle: Stored['idle'] = null; const suspend = options.journal.read('controls/worker-suspend', 'intent'), suspendReceipt = options.journal.read('controls/worker-suspend', 'receipt'); if (suspend && suspendReceipt?.status === 'KNOWN_ACCEPTED') {
    const resumed = options.journal.read('controls/worker-resume', 'receipt')?.status === 'KNOWN_ACCEPTED';
    need(suspend.instanceId && (resumed ? worker.suspended === 'not_suspended' && worker.instances.length === 1 && worker.instances.every(i => i.id !== suspend.instanceId && i.ready === true) : worker.suspended === 'suspended' && worker.instances.length === 0), 'actual_worker_absent');
    const log = await transport.readWorkerStop(suspend.instanceId, suspend.at);
    stop = { instanceId: suspend.instanceId, requestedAt: suspend.at, acknowledgedAt: log.stopAcknowledgedAt, absentAt: new Date().toISOString() };
    if (resumed) {
        const resumeIntent = options.journal.read('controls/worker-resume', 'intent');
        need(resumeIntent, 'actual_resume_intent');
        idle = await transport.readWorkerIdle(String(worker.instances[0].id), resumeIntent.at);
    }
} const checkedAt = new Date().toISOString(); need(Date.parse(checkedAt) - Date.parse(observedFrom) <= 60000, 'bounded_observation_frame'); const skew = plan.clockSkewSeconds * 1000; need(Date.parse(baseline.capturedAt) >= Date.parse(observedFrom) - skew && Date.parse(baseline.databaseClock) <= Date.parse(checkedAt) + skew && Date.parse(String(state.serverNow)) >= Date.parse(observedFrom) - skew && Date.parse(String(state.serverNow)) <= Date.parse(checkedAt) + skew, 'actual_snapshot_observation_times'); const rawEvidence = { source, services: [web, worker].map(s => ({ id: s.id, environmentSHA256: digest(s.environment), configSHA256: s.configSHA256, live: s.live, newest: s.newest, suspended: s.suspended, instances: s.instances, jobs: s.jobs.map(x => ({ id: x.id, status: x.status, planId: x.planId, serviceId: x.serviceId, startCommandSHA256: digest(String(x.startCommand)) })) })), state, baseline, authSHA256: digest(auth), authVersion, authCapability, stop, idle }; const handle = Object.freeze({ checkedAt, evidenceSHA256: digest(rawEvidence), expectedSHA: plan.expectedSHA, windowId: scope?.windowId ?? null }); owned.set(handle, { plan, transport, scope, checkedAt, observedFrom, services: [web, worker], state, baseline, auth: auth as Record<string, unknown>, preimage, source, authVersion, rawEvidence, stop, idle, drains: [...(options.drains ?? [])], journal: options.journal, verifyLocalSource: () => localSource(plan, options) }); return handle; }
export function observedReadiness(handle: Readiness, plan: W2Plan, scope: Scope | null, transport: FiniteTransport, now = Date.now()) { return safe(rawReadiness(handle, plan, scope, transport, now)); }
export function consumeReadiness(handle: Readiness, plan: W2Plan, slot: Slot, scope: Scope | null, transport: FiniteTransport, now = Date.now()) { const proof = rawReadiness(handle, plan, scope, transport, now); if (slot !== 'db/stop')
    expectedCurrentControls(proof); need(slot === 'db/stop' || proof.services.every(s => s.jobs.every(j => ['succeeded', 'failed', 'canceled', 'cancelled'].includes(String(j.status)))), 'active_oneoff_STOP'); const worker = proof.services.find(x => x.id === FIXED.worker)!; need(digest(worker.environment) === digest(proof.preimage.worker), 'worker_full_environment'); const window = proof.state.window as {
    status: string;
    armed_at: string | null;
    expires_at: string | null;
    personal_deadline_at: string | null;
} | null; const restoring = slot.startsWith('controls/env-restore') || slot.startsWith('controls/auth-restore') || slot.startsWith('controls/web-deploy-restore') || slot === 'controls/worker-resume' || slot === 'db/free-cas' || slot.startsWith('db/terminalize'); if (slot === 'db/prepare') {
    need(window === null && captureFingerprint(proof.baseline,preservationContext(plan)) === plan.finalBaselineSHA256, 'post_human_final_baseline');
}
else if (restoring)
    need(window?.status === 'stopped', 'stopped_before_containment');
else if (slot.startsWith('controls/'))
    need(window?.status === 'prepared' && window.armed_at === null && window.expires_at === null, 'unarmed_controls');
else if (slot !== 'db/stop' && slot !== 'db/arm')
    need(window?.status === 'active' && Date.parse(window.expires_at!) > now, 'active_window'); if (slot === 'db/arm')
    need(window?.status === 'prepared' && window.armed_at === null && window.expires_at === null, 'prepared_arm'); if (window?.armed_at) {
    need(Date.parse(window.expires_at!) - Date.parse(window.armed_at) === 3600000 && Date.parse(window.personal_deadline_at!) - Date.parse(window.armed_at) === 1200000, 'immutable_clock');
    if (slot.startsWith('render/access/'))
        need(now < Date.parse(window.armed_at) + 600000, 'access_cutoff');
    if (slot === 'render/team_ai_report')
        need(Date.parse(window.expires_at!) - now > 720000, 'report_margin');
} if (slot === 'db/arm') {
    const cohort = proof.state.cohort as {
        expiry: string;
    }[];
    need(cohort.every(x => Date.parse(x.expiry) > now + 3600000), 'invite_full_window');
} if (slot === 'db/arm' || slot.startsWith('render/') || slot === 'controls/worker-resume') {
    need(proof.stop && worker.suspended === 'suspended' && worker.instances.length === 0, 'actual_stopped_worker');
    need(now - Date.parse(proof.stop.requestedAt) <= 4500000, 'pause_75m');
    if (slot === 'db/arm')
        need(now - Date.parse(proof.stop.requestedAt) <= 300000, 'stop_to_arm_5m');
    need(proof.drains.length === 2, 'two_actual_drains');
    const observed = proof.drains.map(d => { const p = owned.get(d); need(p && p.plan === plan && p.transport === proof.transport && p.journal === proof.journal && p.scope?.windowId === proof.scope?.windowId && p.stop?.instanceId === proof.stop?.instanceId && p.state.publicEligible === 0 && p.state.teamEligible === 0 && p.state.leases === 0, 'global_drain_not_target_excluded'); fresh(d.checkedAt, now); fresh(p.observedFrom, now); p.verifyLocalSource(); return Date.parse(d.checkedAt); });
    need(observed[1] - observed[0] >= 15000 && observed[0] >= Date.parse(proof.stop.acknowledgedAt) && observed[1] <= Date.parse(proof.checkedAt), 'drain_order');
} return safe(proof); }
export function readinessSummary(handle: Readiness) { const p = owned.get(handle); need(p, 'owned_readiness'); return Object.freeze({ checkedAt: handle.checkedAt, evidenceSHA256: handle.evidenceSHA256, baselineSHA256: digest(p.baseline), stateSHA256: digest(p.state), authSHA256: digest(p.auth), authVersion: p.authVersion, services: p.services.map(s => ({ id: s.id, environmentSHA256: digest(s.environment), configSHA256: s.configSHA256, liveDeployId: s.live.id, newestSuccessfulDeployId: s.newest.id, suspended: s.suspended, instanceCount: s.instances.length, oneoffCount: s.jobs.length })) }); }
