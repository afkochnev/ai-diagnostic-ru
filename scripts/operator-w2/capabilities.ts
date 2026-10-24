import { z } from 'zod';
import { createHmac, randomBytes } from 'node:crypto';
import { consumeReservation, type JournalRecord } from './journal';
import { consumeReadiness, type Readiness } from './readiness';
import { prepareControlledWindowDispatch } from '../../src/server/team/controlled-window-dispatch';
import { parseControlledAccessManifest } from '../../src/server/team/controlled-access-runner';
import { FIXED, OFF, PARTICIPANTS, WEB, assertEnvironment, digest, need, parse, slot, type Scope, type Slot, type W2Plan } from './contract';
export type Wire = {
    method: 'GET' | 'POST' | 'PUT' | 'PATCH';
    origin: 'https://api.render.com' | 'https://api.supabase.com' | 'https://fhvxqeaujjeiflanqsbg.supabase.co';
    path: string;
    body: unknown;
};
export type Capability = Readonly<{
    slot: Slot;
    requestSHA256: string;
    windowId: string | null;
    noOp: boolean;
}>;
const wires = new WeakMap<Capability, {
    wire: Wire;
    plan: W2Plan;
    expectedFullHash?: string;
}>();
function capability(plan: W2Plan, key: Slot, windowId: string | null, wire: Wire, noOp = false, expectedFullHash?: string): Capability { const handle = Object.freeze({ slot: key, requestSHA256: digest(wire), windowId, noOp }); wires.set(handle, { wire, plan, expectedFullHash }); return handle; }
function inspectCapability(handle: Capability, plan: W2Plan) { const value = wires.get(handle); need(value && value.plan === plan && digest(value.wire) === handle.requestSHA256, 'owned_capability'); return value.wire; }
function quote(value: string) { return "'" + value.replaceAll("'", "'\"'\"'") + "'"; }
function materialize(json: string, path: string, manifestHash: string) { const code = `const f=require('node:fs'),c=require('node:crypto'),p=require('node:path'),dest=${JSON.stringify(path)},b=Buffer.from(${JSON.stringify(Buffer.from(json).toString('base64'))},'base64'),base='/tmp/aca-v27-controlled-team';if(b.length>8192||!dest.startsWith(base+'/')||c.createHash('sha256').update(b).digest('hex')!==${JSON.stringify(manifestHash)})throw Error('manifest_hash');JSON.parse(b.toString('utf8'));let d='/';for(const part of p.dirname(dest).split('/').filter(Boolean)){d=p.join(d,part);try{f.mkdirSync(d,{mode:448});}catch(e){if(e.code!=='EEXIST')throw e;}const s=f.lstatSync(d);if(!s.isDirectory()||s.isSymbolicLink()||(d===base||d.startsWith(base+'/'))&&((s.mode&511)!==448||s.uid!==process.getuid()))throw Error('private_manifest_dir');}const fd=f.openSync(dest,f.constants.O_WRONLY|f.constants.O_CREAT|f.constants.O_EXCL|f.constants.O_NOFOLLOW,384);try{let n=0;while(n<b.length){const k=f.writeSync(fd,b,n,b.length-n);if(k<=0)throw Error('manifest_partial');n+=k;}f.fsyncSync(fd);const s=f.fstatSync(fd);if(!s.isFile()||(s.mode&511)!==384||s.uid!==process.getuid()||s.size!==b.length)throw Error('private_manifest');}finally{f.closeSync(fd);}const dir=f.openSync(p.dirname(dest),f.constants.O_RDONLY);try{f.fsyncSync(dir);}finally{f.closeSync(dir);}`; return `node -e ${quote(code)}`; }
function runtime(plan: W2Plan, foundation: 'true' | 'false') { const code = `const e=process.env;if(e.RENDER_GIT_COMMIT!==${JSON.stringify(plan.expectedSHA)}||e.NODE_ENV!=='production'||e.APP_URL!==${JSON.stringify(FIXED.origin)}||e.SUPABASE_URL!==${JSON.stringify('https://' + FIXED.project + '.supabase.co')}||e.TEAM_ENABLED!==${JSON.stringify(foundation)}||e.YOOKASSA_SECRET_KEY||${JSON.stringify(OFF)}.some(k=>e[k]!=='false'))throw Error('runtime_binding');`; return `node -e ${quote(code)}`; }
export function accessJob(plan: W2Plan, scope: Scope, participantId: string) { need((PARTICIPANTS as readonly string[]).includes(participantId) && scope.expectedSHA === plan.expectedSHA && scope.planSHA256 === plan.planSHA256, 'access_scope'); const manifest = parseControlledAccessManifest({ version: 2, operation: 'participant_access_recovery', runId: FIXED.root, continuationWindowId: scope.windowId, teamId: FIXED.team, participantId, expectedSHA: plan.expectedSHA, planSHA256: plan.planSHA256 }); const json = JSON.stringify(manifest), path = `/tmp/aca-v27-controlled-team/${FIXED.root}/${scope.windowId}/access-${participantId}.json`, command = `cd '/app' && ${runtime(plan, 'true')} && ${materialize(json, path, digest(json))} && exec node --import tsx scripts/controlled-team-w2-access.ts ${quote(path)}`; return capability(plan, slot('render/access/' + participantId), scope.windowId, { method: 'POST', origin: 'https://api.render.com', path: `/v1/services/${WEB}/jobs`, body: { startCommand: command, planId: FIXED.planId } }); }
export function workerJob(plan: W2Plan, scope: Scope, kind: 'team_aggregate' | 'team_ai_report', sourceFingerprint: string, reportId: string | null) { const approved = { runId: FIXED.root, continuationWindowId: scope.windowId, teamId: FIXED.team, sourceFingerprint, expectedSHA: plan.expectedSHA, planSHA256: plan.planSHA256 }; need(scope.expectedSHA === plan.expectedSHA && scope.planSHA256 === plan.planSHA256, 'worker_scope'); const build = prepareControlledWindowDispatch({ version: 2, ...approved, kind, reportId }, approved), command = `cd '/app' && ${runtime(plan, 'false')} && ${materialize(build.manifestJSON, build.manifestPath, build.manifestSHA256)} && ${build.command}`; return capability(plan, slot('render/' + kind), scope.windowId, { method: 'POST', origin: 'https://api.render.com', path: `/v1/services/${FIXED.worker}/jobs`, body: { startCommand: command, planId: FIXED.planId } }); }
export type Preimage = {
    web: Record<string, string>;
    worker: Record<string, string>;
    auth: Record<string, unknown> & {
        uri_allow_list: string;
    };
};
/** Full values stay inside this closure and finite transport; handles never
 * include env/config/request bodies. Absence of a key is preserved on restore. */
export function controls(plan: W2Plan, preimage: Preimage) {
    const baseline = structuredClone(parse(z.strictObject({ web: z.record(z.string(), z.string()), worker: z.record(z.string(), z.string()), auth: z.record(z.string(), z.unknown()).refine(x => typeof x.uri_allow_list === 'string') }), preimage)) as Preimage;
    assertEnvironment(baseline.web, 'false');
    assertEnvironment(baseline.worker, 'false');
    need(digest(baseline.web) === plan.preimage.webEnvSHA256 && digest(baseline.worker) === plan.preimage.workerEnvSHA256 && digest(baseline.auth) === plan.preimage.authConfigSHA256, 'approved_preimage');
    const warm = { ...baseline.web, TEAM_ENABLED: 'true', TEAM_INVITATION_EMAIL_PROVIDER: 'resend', TEAM_AI_PROVIDER: 'openai' };
    const present = baseline.auth.uri_allow_list.split(',').map(x => x.trim()).includes(FIXED.callback), authWarm = { ...baseline.auth, uri_allow_list: present ? baseline.auth.uri_allow_list : baseline.auth.uri_allow_list + (baseline.auth.uri_allow_list ? ',' : '') + FIXED.callback };
    const env = (e: Record<string, string>) => Object.keys(e).sort().map(key => ({ key, value: e[key] }));
    return Object.freeze({ fingerprints: Object.freeze({ webBefore: digest(baseline.web), workerBefore: digest(baseline.worker), authBefore: digest(baseline.auth), webWarm: digest(warm), authWarm: digest(authWarm), authAdditionNeeded: !present }), build(key: 'auth-add' | 'env-warm' | 'web-deploy-warm' | 'worker-suspend' | 'env-restore' | 'auth-restore' | 'web-deploy-restore' | 'worker-resume', scope: Scope) { let wire: Wire, noOp = false; if (key === 'env-warm' || key === 'env-restore')
            wire = { method: 'PUT', origin: 'https://api.render.com', path: `/v1/services/${WEB}/env-vars`, body: env(key === 'env-warm' ? warm : baseline.web) };
        else if (key === 'auth-add' || key === 'auth-restore') {
            noOp = present;
            wire = { method: 'PATCH', origin: 'https://api.supabase.com', path: `/v1/projects/${FIXED.project}/config/auth`, body: { uri_allow_list: key === 'auth-add' ? authWarm.uri_allow_list : baseline.auth.uri_allow_list } };
        }
        else if (key === 'web-deploy-warm' || key === 'web-deploy-restore')
            wire = { method: 'POST', origin: 'https://api.render.com', path: `/v1/services/${WEB}/deploys`, body: { commitId: plan.expectedSHA, clearCache: 'do_not_clear' } };
        else {
            need(key === 'worker-suspend' || key === 'worker-resume', 'finite_control');
            wire = { method: 'POST', origin: 'https://api.render.com', path: `/v1/services/${FIXED.worker}/${key === 'worker-suspend' ? 'suspend' : 'resume'}`, body: null };
        } return capability(plan, slot('controls/' + key), scope.windowId, wire, noOp, key.startsWith('auth-') ? digest(key === 'auth-add' ? authWarm : baseline.auth) : undefined); } });
}
const sqlQuote = (x: string) => "'" + x.replaceAll("'", "''") + "'";
export function databaseAction(plan: W2Plan, scope: Scope, kind: 'prepare' | 'arm' | 'stop' | 'terminalize-aggregate' | 'terminalize-report', targetJobId?: string) { need(scope.expectedSHA === plan.expectedSHA && scope.planSHA256 === plan.planSHA256, 'db_scope'); let query: string; const w = sqlQuote(z.uuid().parse(scope.windowId)), r = sqlQuote(FIXED.root), h = sqlQuote(plan.planSHA256); if (kind === 'prepare')
    query = `select private.configure_controlled_team_w2(${w}::uuid,${r}::uuid,${sqlQuote(FIXED.freeSubscription)}::uuid,${h}) as result;`;
else if (kind === 'arm')
    query = `select private.arm_controlled_team_w2(${w}::uuid,${h}) as result;`;
else if (kind === 'stop')
    return capability(plan, 'db/stop', scope.windowId, { method: 'POST', origin: 'https://fhvxqeaujjeiflanqsbg.supabase.co', path: '/rest/v1/rpc/stop_controlled_team_window', body: { p_run_id: FIXED.root, p_window_id: scope.windowId, p_reason: 'w2_operator_stop' } });
else {
    need(kind === 'terminalize-aggregate' || kind === 'terminalize-report', 'finite_db_action');
    const id = z.uuid().parse(targetJobId);
    return capability(plan, slot('db/' + kind), scope.windowId, { method: 'POST', origin: 'https://fhvxqeaujjeiflanqsbg.supabase.co', path: '/rest/v1/rpc/terminalize_controlled_team_window_job', body: { p_run_id: FIXED.root, p_window_id: scope.windowId, p_job_id: id, p_reason: 'w2_operator_containment' } });
} return capability(plan, slot('db/' + kind), scope.windowId, { method: 'POST', origin: 'https://api.supabase.com', path: `/v1/projects/${FIXED.project}/database/query`, body: { query, read_only: false } }); }
export type TransportMode = 'READ_ONLY' | 'LOCAL_MOCK' | 'PRODUCTION';
export type TransportReceipt = Readonly<{
    status: 'KNOWN_ACCEPTED';
    httpStatus: number | null;
    providerId: string | null;
    responseSHA256: string;
    requestSHA256: string;
}>;
export type ReadResource = 'service' | 'environment' | 'deploys' | 'jobs' | 'instances';
const ownedTransports = new WeakMap<object, W2Plan>();
export function assertOwnedTransport(transport: object, plan: W2Plan) { need(ownedTransports.get(transport) === plan, 'owned_finite_transport'); }
/** Fixed finite transport. No default fetch/credential loader, caller URL/SQL,
 * shell, fallback, redirects, SDK or retry. Values remain closure-private. */
export function createFiniteTransport(plan: W2Plan, options: {
    mode: TransportMode;
    fetch: typeof fetch;
    credentials: {
        render: string;
        management: string;
        github: string;
        serviceRole: string;
    };
}) {
    options = { ...options, credentials: { ...options.credentials } };
    need(typeof options.fetch === 'function' && ['READ_ONLY', 'LOCAL_MOCK', 'PRODUCTION'].includes(options.mode), 'explicit_transport');
    need(options.mode !== 'PRODUCTION' || plan.authorization === 'EXPLICIT_OWNER_W2_EXECUTION', 'transport_authority');
    const credentials = { ...options.credentials };
    need(Object.values(credentials).every(x => typeof x === 'string' && x.length > 0), 'protected_credentials');
    async function boundedJSON(response: Response, controller: AbortController) {
        const maximum = 16777216, contentLength = response.headers.get('content-length');
        need(contentLength === null || /^\d+$/.test(contentLength) && Number(contentLength) <= maximum, 'response_byte_limit');
        if (!response.body) return null;
        const reader = response.body.getReader(), chunks: Uint8Array[] = [];
        let bytes = 0;
        const abort = () => { void reader.cancel().catch(() => {}); };
        controller.signal.addEventListener('abort', abort, { once: true });
        try {
            for (;;) {
                const next = await reader.read();
                need(!controller.signal.aborted, 'response_aborted');
                if (next.done) break;
                need(next.value instanceof Uint8Array && bytes + next.value.byteLength <= maximum, 'response_byte_limit');
                bytes += next.value.byteLength;
                chunks.push(next.value);
            }
            const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, bytes));
            return text ? JSON.parse(text) : null;
        } catch {
            abort();
            throw Error('response_unavailable');
        } finally {
            controller.signal.removeEventListener('abort', abort);
            reader.releaseLock();
        }
    }
    async function request(method: 'GET' | 'POST' | 'PUT' | 'PATCH', origin: string, path: string, body: unknown, credential: 'render' | 'management' | 'github' | 'serviceRole') {
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            return await Promise.race([(async () => { const response = await options.fetch(origin + path, { method, headers: { Authorization: 'Bearer ' + credentials[credential], 'Content-Type': 'application/json', ...(credential === 'github' ? { Accept: 'application/vnd.github+json' } : {}), ...(credential === 'serviceRole' ? { apikey: credentials.serviceRole } : {}) }, ...(body !== null ? { body: JSON.stringify(body) } : {}), redirect: 'error', signal: controller.signal }); need(!response.redirected && response.ok, 'http_status'); return { status: response.status, value: await boundedJSON(response, controller) }; })(), new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(Error('timeout')); }, 30000); })]);
        }
        catch {
            controller.abort();
            throw Error('w2_operator_transport_unknown_STOP');
        }
        finally {
            clearTimeout(timer);
        }
    }
    async function readService(id: string, resource: ReadResource) {
        need(([WEB, FIXED.worker] as readonly string[]).includes(id), 'fixed_service');
        need(['service', 'environment', 'deploys', 'jobs', 'instances'].includes(resource), 'fixed_resource');
        const suffix = { service: '', environment: '/env-vars', deploys: '/deploys', jobs: '/jobs', instances: '/instances' }[resource];
        if (resource === 'service' || resource === 'instances')
            return (await request('GET', 'https://api.render.com', `/v1/services/${id}${suffix}`, null, 'render')).value;
        const result: unknown[] = [];
        let cursor: string | undefined;
        const seen = new Set<string>();
        for (let page = 0; page < 10; page++) {
            const raw = (await request('GET', 'https://api.render.com', `/v1/services/${id}${suffix}?limit=100${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`, null, 'render')).value;
            need(Array.isArray(raw), 'read_list');
            result.push(...raw);
            if (raw.length < 100)
                return result;
            const tail = raw.at(-1) as {
                cursor?: unknown;
            };
            need(typeof tail?.cursor === 'string' && /^[A-Za-z0-9_=-]{1,256}$/.test(tail.cursor) && !seen.has(tail.cursor), 'complete_pagination');
            cursor = tail.cursor;
            seen.add(cursor);
        }
        throw Error('w2_operator_incomplete_inventory');
    }
    const transport = Object.freeze({ mode: options.mode, readService, async checkAuthHeaderCapability() { const challenge = randomBytes(32).toString('hex'), participant = PARTICIPANTS[0], user = 'b7cc06c7-056c-4fd8-b445-eeaf187cec7c', mac = createHmac('sha256', 'Bearer ' + credentials.serviceRole).update(['aca-w2-auth-evidence-v1', 'challenge', FIXED.root, '-', participant, user, 'capability', '-', challenge].join('\n'), 'utf8').digest('hex'), started = Date.now(); const raw = (await request('POST', 'https://fhvxqeaujjeiflanqsbg.supabase.co', '/rest/v1/rpc/check_controlled_team_auth_evidence_key', { p_run_id: FIXED.root, p_window_id: null, p_participant_id: participant, p_user_id: user, p_operation: 'capability', p_reservation_id: null, p_challenge: challenge, p_challenge_mac: mac }, 'serviceRole')).value; const result = parse(z.strictObject({ matched: z.literal(true), run_id: z.literal(FIXED.root), window_id: z.null(), participant_id: z.literal(participant), user_id: z.literal(user), operation: z.literal('capability'), reservation_id: z.null(), server_now: z.iso.datetime({ offset: true }), approved_plan_hash: z.null() }), raw), finished = Date.now(), server = Date.parse(result.server_now), skew = plan.clockSkewSeconds * 1000; need(server >= started - skew && server <= finished + skew, 'capability_clock_scope'); return Object.freeze({ checkedAt: new Date(finished).toISOString(), receiptSHA256: digest(result), matched: true, sideEffectFree: true }); }, async readAuthVersion() {
            const response = await request('GET', 'https://fhvxqeaujjeiflanqsbg.supabase.co', '/auth/v1/health', null, 'serviceRole');
            const value = parse(z.strictObject({ version: z.literal('v2.197.0'), name: z.literal('GoTrue'), description: z.literal('GoTrue is a user registration and authentication API') }), response.value);
            return Object.freeze({ checkedAt: new Date().toISOString(), advertisedVersion: value.version, officialCommit: '4eee58f296d9698a1c2c0ae14d7a0b379c7622d3', versionEvidenceKind: 'SELF_REPORTED_HEALTH_NOT_BINARY_ATTESTATION' as const, receiptSHA256: digest(value) });
        }, async readWorkerStop(instanceId: string, since: string) { need(/^srv-dak5rurl550s73a17l60-[A-Za-z0-9]{3,30}$/.test(instanceId) && Number.isFinite(Date.parse(since)) && Date.parse(since) <= Date.now() && Date.now() - Date.parse(since) <= 4500000, 'fixed_stop_log_scope'); const until = new Date().toISOString(), query = new URLSearchParams({ ownerId: 'tea-daipgd67bikc739jftl0', resource: FIXED.worker, instance: instanceId, startTime: since, endTime: until, direction: 'forward', text: '[worker] stopped', limit: '100' }); const raw = (await request('GET', 'https://api.render.com', '/v1/logs?' + query, null, 'render')).value as {
            logs?: {
                message?: string;
                timestamp?: string;
            }[];
            hasMore?: boolean;
        }; need(raw && Array.isArray(raw.logs) && raw.hasMore === false, 'complete_worker_stop_logs'); const stop = raw.logs.find(x => x.message === '[worker] stopped' && typeof x.timestamp === 'string' && Date.parse(x.timestamp) >= Date.parse(since) && Date.parse(x.timestamp) <= Date.parse(until)); need(stop, 'positive_actual_worker_stop'); return Object.freeze({ instanceId, stopAcknowledgedAt: stop.timestamp!, checkedAt: until, evidenceSHA256: digest(raw) }); }, async readWorkerIdle(instanceId: string, since: string) { need(/^srv-dak5rurl550s73a17l60-[A-Za-z0-9]{3,30}$/.test(instanceId) && Number.isFinite(Date.parse(since)) && Date.parse(since) <= Date.now(), 'fixed_idle_log_scope'); const until = new Date().toISOString(), start = new Date(Math.max(Date.parse(since), Date.now() - 60000)).toISOString(), query = new URLSearchParams({ ownerId: 'tea-daipgd67bikc739jftl0', resource: FIXED.worker, instance: instanceId, startTime: start, endTime: until, direction: 'forward', text: 'claim_success', limit: '100' }), raw = (await request('GET', 'https://api.render.com', '/v1/logs?' + query, null, 'render')).value as {
            logs?: {
                message?: string;
                timestamp?: string;
            }[];
            hasMore?: boolean;
        }; need(raw && Array.isArray(raw.logs) && raw.hasMore === false, 'complete_worker_idle_logs'); const entries = raw.logs.filter(x => x.message === "[consultation-worker] { checkpoint: 'claim_success', claimed: 0 }" && typeof x.timestamp === 'string' && Date.parse(x.timestamp) >= Date.parse(start) && Date.parse(x.timestamp) <= Date.parse(until)); need(entries.length > 0, 'positive_actual_new_worker_empty_claim'); return Object.freeze({ instanceId, observedAt: entries.at(-1)!.timestamp!, checkedAt: until, evidenceSHA256: digest(raw) }); }, async readAuthConfiguration() { return (await request('GET', 'https://api.supabase.com', `/v1/projects/${FIXED.project}/config/auth`, null, 'management')).value; }, async readSource() { return { main: (await request('GET', 'https://api.github.com', '/repos/afkochnev/ai-diagnostic-ru/commits/main', null, 'github')).value, checks: (await request('GET', 'https://api.github.com', `/repos/afkochnev/ai-diagnostic-ru/commits/${plan.expectedSHA}/check-runs?per_page=100`, null, 'github')).value }; }, async readDatabase(name: import('./read-queries').ReadQuery | 'w2_preservation_capture_v1') { if (name === 'w2_preservation_capture_v1')
            return (await request('GET', 'https://fhvxqeaujjeiflanqsbg.supabase.co', '/rest/v1/rpc/capture_controlled_team_w2_preservation', null, 'serviceRole')).value; const { READ_QUERIES } = await import('./read-queries'); need(Object.hasOwn(READ_QUERIES, name), 'fixed_select'); return (await request('POST', 'https://api.supabase.com', `/v1/projects/${FIXED.project}/database/query`, { query: READ_QUERIES[name], read_only: true }, 'management')).value; },
        /** Internal to the serial operator: a root intent and owned readiness must
         * already exist. This transport never accepts a caller wire or command. */
        async execute(handle: Capability, reservation: JournalRecord, readiness: Readiness): Promise<TransportReceipt> {
            consumeReadiness(readiness, plan, handle.slot, handle.windowId && handle.slot !== 'db/prepare' ? { windowId: handle.windowId, expectedSHA: plan.expectedSHA, planSHA256: plan.planSHA256 } : null, transport);
            consumeReservation(reservation, plan, handle.slot, handle.requestSHA256, handle.windowId, options.mode);
            need(options.mode !== 'READ_ONLY', 'read_only_transport');
            const wire = inspectCapability(handle, plan);
            if (handle.noOp)
                return Object.freeze({ status: 'KNOWN_ACCEPTED', httpStatus: null, providerId: null, responseSHA256: digest({ noOp: true }), requestSHA256: handle.requestSHA256 });
            const response = await request(wire.method, wire.origin, wire.path, wire.body, wire.origin === 'https://api.render.com' ? 'render' : wire.origin === 'https://api.supabase.com' ? 'management' : 'serviceRole');
            const value = response.value as Record<string, unknown> | null;
            let providerId: string | null = null;
            if (handle.slot.startsWith('render/')) {
                need(value && typeof value.id === 'string' && /^job-[a-z0-9]{8,100}$/.test(value.id) && value.serviceId === (handle.slot.startsWith('render/access/') ? WEB : FIXED.worker) && value.planId === FIXED.planId, 'job_receipt');
                const body = wire.body as {
                    startCommand: string;
                };
                need(typeof value.startCommand === 'string' && value.startCommand === body.startCommand, 'job_command_receipt');
                providerId = value.id;
            }
            if (handle.slot.startsWith('controls/web-deploy-')) {
                need(value && typeof value.id === 'string' && /^dep-[a-z0-9]{8,100}$/.test(value.id) && ((value.commit as {
                    id?: unknown;
                } | undefined)?.id ?? value.commitId) === plan.expectedSHA, 'deploy_receipt');
                providerId = value.id;
            }
            if (handle.slot === 'controls/env-warm' || handle.slot === 'controls/env-restore') {
                need(response.status === 200, 'environment_status');
                const readback = await readService(WEB, 'environment');
                need(Array.isArray(readback), 'environment_readback');
                const actual = Object.fromEntries(readback.map(x => { const v = (x as {
                    envVar?: {
                        key: string;
                        value: string;
                    };
                }).envVar ?? x as {
                    key: string;
                    value: string;
                }; return [v.key, v.value]; })), desired = Object.fromEntries((wire.body as {
                    key: string;
                    value: string;
                }[]).map(x => [x.key, x.value]));
                need(digest(actual) === digest(desired), 'full_environment_readback');
            }
            if (handle.slot === 'controls/auth-add' || handle.slot === 'controls/auth-restore') {
                const actual = (await request('GET', 'https://api.supabase.com', `/v1/projects/${FIXED.project}/config/auth`, null, 'management')).value;
                need(digest(actual) === wires.get(handle)?.expectedFullHash, 'full_auth_configuration_readback');
            }
            if (handle.slot === 'controls/worker-suspend' || handle.slot === 'controls/worker-resume')
                need(response.status === 202, 'lifecycle_accepted_status');
            if (handle.slot === 'db/prepare' || handle.slot === 'db/arm') {
                need(Array.isArray(response.value) && response.value.length === 1, 'db_mutation_result');
                const result = (response.value[0] as {
                    result?: {
                        status?: unknown;
                        run_id?: unknown;
                        window_id?: unknown;
                        expires_at?: unknown;
                    };
                }).result;
                need(result?.run_id === FIXED.root && result.window_id === handle.windowId && result.status === (handle.slot === 'db/prepare' ? 'prepared' : 'active') && (handle.slot !== 'db/prepare' || result.expires_at === null), 'db_mutation_binding');
            }
            if (handle.slot === 'db/stop')
                need(value?.status === 'stopped' && value.window_id === handle.windowId && value.run_id === FIXED.root, 'stop_receipt');
            if (handle.slot.startsWith('db/terminalize-'))
                need(value?.status === 'failed' || value?.status === 'completed', 'terminalizer_receipt');
            return Object.freeze({ status: 'KNOWN_ACCEPTED', httpStatus: response.status, providerId, responseSHA256: digest(response.value), requestSHA256: handle.requestSHA256 });
        }
    });
    ownedTransports.set(transport, plan);
    return transport;
}
export type FiniteTransport = ReturnType<typeof createFiniteTransport>;
