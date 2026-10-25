import {deriveEvidenceChannelKey,evidenceChannelHeader,evidenceChannelMAC} from '../../src/server/team/evidence-channel-key';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { accessJob, controls, createFiniteTransport, databaseAction, workerJob } from '../../scripts/operator-w2/capabilities';
import { FIXED, OFF, OLD_EFFECTS, PARTICIPANTS, REQUIRED_SOURCE_FILES, WEB, bytesDigest, createW2Plan, digest, scope } from '../../scripts/operator-w2/contract';
import { openRootJournal } from '../../scripts/operator-w2/journal';
import { collectReadiness, consumeReadiness, observedReadiness, readinessSummary } from '../../scripts/operator-w2/readiness';
import { captureFingerprint as fingerprint, preservationContext } from '../../scripts/operator-w2/preservation';
import { CAPTURE_TABLES } from '../../scripts/operator-w2/capture-queries';
import { createW2Operator } from '../../scripts/operator-w2/operator';
import * as pf from './preservation-fixtures';
import { COHORT, type PreservationSnapshot } from '../../scripts/operator-w2/preservation';
import { createLocalMockFixture, fixtureCanonicalJSON, fixtureAnswerExpectation } from '../../scripts/operator-w2/fixture';
import preservationColumns from './fixtures/preservation-columns.json';
const H = 'a'.repeat(64), SHA = 'a'.repeat(40), TREE = 'b'.repeat(40), W = '00000000-0000-4000-8000-000000000202';
const evidenceContext=preservationContext({rootId:FIXED.root,planSHA256:H,expectedSHA:SHA});
const captureFingerprint=(value:unknown)=>fingerprint(value,evidenceContext);
const rootSecret='synthetic-existing-auth-flow-secret-for-operator-tests';
const evidenceKey=()=>deriveEvidenceChannelKey(rootSecret,evidenceContext);
const directories: string[] = [];
const directory = () => { const p = mkdtempSync(join(realpathSync(tmpdir()), 'operator-w2-test-')); chmodSync(p, 0o700); directories.push(p); return p; };
afterEach(() => { vi.useRealTimers(); for (const p of directories.splice(0))
    rmSync(p, { recursive: true, force: true }); vi.unstubAllGlobals(); });
const env = () => ({ APP_URL: FIXED.origin, SUPABASE_URL: `https://${FIXED.project}.supabase.co`, ...Object.fromEntries(OFF.map(k => [k, 'false'])), TEAM_ENABLED: 'false', AUTH_FLOW_SECRET:rootSecret, SECRET_FOR_TEST: 'FAKE_SECRET_NOT_REAL' });
function fixture() { const now = new Date().toISOString(); const preimage = { web: env(), worker: env(), auth: { uri_allow_list: FIXED.origin + '/auth/confirm', site_url: FIXED.origin, external_email_enabled: true } }; const snapshot: PreservationSnapshot = { format: 'ACA_W2_PRESERVATION_HMAC_V2' as const, capturedAt: now, databaseClock: now, transactionReadOnly: 'on' as const, timezone: 'UTC' as const, algorithm:'HMAC-SHA256' as const,context:evidenceContext, project: FIXED.project, tables: Object.fromEntries(CAPTURE_TABLES.map(name => [name, { columns: (preservationColumns as Record<string, string[]>)[name], rows: [] }])), catalogue: H, ledger: { count: 57, digest: H }, gates: { launch: 0, financial: 0 }, wireTraces: [] }; const sourceManifest = Object.fromEntries(REQUIRED_SOURCE_FILES.map(p => [p, H])); const config = (id: string) => ({ id, owner: 'tea-daipgd67bikc739jftl0', type: id === WEB ? 'web_service' : 'background_worker', repo: 'https://github.com/afkochnev/ai-diagnostic-ru', branch: 'main', autoDeploy: 'no', rootDir: '', details: {} }); const effects = OLD_EFFECTS.map(id => ({ id, status: 'succeeded', fingerprint: H })); for (const id of OLD_EFFECTS)
    addRow(snapshot, 'private.controlled_team_effects', id, { id, run_id: FIXED.root, window_id: null, status: 'succeeded' }); addRow(snapshot, 'private.account_subscriptions', FIXED.freeSubscription, { id: FIXED.freeSubscription, account_id: FIXED.account, plan_key: 'free', status: 'active', source: 'manual', effective_until: null, providerFieldsNull: true }); const input = { version: 1, authorization: 'LOCAL_MOCK_ONLY', rootId: FIXED.root, teamId: FIXED.team, expectedSHA: SHA, treeSHA: TREE, planSHA256: H, sourceManifest, sourceManifestSHA256: digest(sourceManifest), oldEffectsSHA256: digest(effects), finalBaselineSHA256: captureFingerprint(snapshot), fixtureCommitmentSHA256: H, clockSkewSeconds: 0, clockPolicyApproved: false, preimage: { webDeployId: 'dep-current00000000', workerDeployId: 'dep-current00000000', webEnvSHA256: digest(preimage.web), workerEnvSHA256: digest(preimage.worker), authConfigSHA256: digest(preimage.auth), webConfigSHA256: digest(config(WEB)), workerConfigSHA256: digest(config(FIXED.worker)), webOneoffsSHA256: digest([]), workerOneoffsSHA256: digest([]) }, maximumRenderJobs: 5, maximumAccessJobs: 3, maximumAuthLinks: 3, maximumVerifications: 3, maximumModelGET: 1, maximumResponses: 4, maximumResponseOutputParameterSum: 32000, maximumEmails: 3, maximumAggregate: 1, maximumReport: 1, maximumPDF: 1, maximumWebDeploys: 2, maximumEnvWrites: 2, maximumAuthConfigWrites: 2, maximumSuspend: 1, maximumResume: 1, maximumManualWorkerDeploy: 0 }; const plan = createW2Plan(input), journal = openRootJournal(plan, { mode: 'LOCAL_MOCK', base: directory() }); const runtime = { webEnvironment: { ...preimage.web }, workerEnvironment: { ...preimage.worker }, auth: structuredClone(preimage.auth), suspended: false, instanceId: FIXED.worker + '-abc12', webDeployId: 'dep-current00000000', workerDeployId: 'dep-current00000000', workerTrigger: undefined as string | undefined, workerDeployCreatedAt: undefined as string | undefined, stopAt: undefined as string | undefined, webJobs: [] as Record<string, unknown>[], workerJobs: [] as Record<string, unknown>[] }; const calls: {
    url: string;
    method: string;
    body: unknown;
}[] = []; let mutation: ((url: string, init: RequestInit) => Response | Promise<Response>) | undefined; const state = { serverNow: now, timezone: 'UTC', publicEligible: 0, teamEligible: 0, leases: 0, openLaunchGates: 0, openFinancialGates: 0, root: { id: FIXED.root, status: 'stopped' }, window: null as null | Record<string, unknown>, oldEffects: effects, cohort: PARTICIPANTS.map(id => ({ id, team: FIXED.team, status: 'invited', expiry: new Date(Date.now() + 86400000).toISOString(), binding: H })), targetJobs: [], subscriptions: [{ id: FIXED.freeSubscription as string, plan: 'free', status: 'active', source: 'manual' }], planChanges: [] }; const fetch: typeof globalThis.fetch = vi.fn(async (input, init) => { const u = new URL(String(input)), method = init?.method ?? 'GET', body = typeof init?.body === 'string' ? JSON.parse(init.body) : null; calls.push({ url: u.href, method, body }); if (u.hostname === 'api.github.com')
    return Response.json(u.pathname.endsWith('/main') ? { sha: SHA, commit: { tree: { sha: TREE } } } : { total_count: 2, check_runs: ['application', 'isolated-sql'].map(name => ({ name, head_sha: SHA, status: 'completed', conclusion: 'success' })) }); if (u.pathname === '/auth/v1/health') return Response.json({ version: 'v2.197.0', name: 'GoTrue', description: 'GoTrue is a user registration and authentication API' }); if (u.pathname.endsWith('/rpc/check_controlled_team_auth_evidence_key'))
    return Response.json({ matched: true, run_id: FIXED.root, window_id: null, participant_id: PARTICIPANTS[0], user_id: 'b7cc06c7-056c-4fd8-b445-eeaf187cec7c', operation: 'capability', reservation_id: null, server_now: new Date().toISOString(), approved_plan_hash: null }); if (u.pathname.endsWith('/config/auth') && method === 'GET')
    return Response.json(runtime.auth); if (u.pathname.endsWith('/rpc/capture_controlled_team_w2_preservation')) {
    const at = new Date().toISOString();
    snapshot.capturedAt = at;
    snapshot.databaseClock = at;
    return Response.json(snapshot);
} if (u.pathname.endsWith('/database/query') && body?.read_only === true) {
    state.serverNow = new Date().toISOString();
    return Response.json([{ evidence: state }]);
} if (u.hostname === 'api.render.com' && method === 'GET') {
    const id = u.pathname.includes(WEB) ? WEB : FIXED.worker;
    if (u.pathname.endsWith('/env-vars'))
        return Response.json(Object.entries(id === WEB ? runtime.webEnvironment : runtime.workerEnvironment).map(([key, value]) => ({ envVar: { key, value } })));
    if (u.pathname.endsWith('/deploys'))
        return Response.json([{ deploy: { id: id === WEB ? runtime.webDeployId : runtime.workerDeployId, status: 'live', commit: { id: SHA }, ...(id === FIXED.worker && runtime.workerTrigger ? { trigger: runtime.workerTrigger, createdAt: runtime.workerDeployCreatedAt } : {}) } }]);
    if (u.pathname.endsWith('/jobs'))
        return Response.json((id === WEB ? runtime.webJobs : runtime.workerJobs).map(job => ({ job })));
    if (u.pathname.endsWith('/instances'))
        return Response.json(runtime.suspended ? [] : [{ instance: { id: runtime.instanceId, status: 'RUNNING', ready: true } }]);
    if (u.pathname === '/v1/logs')
        return Response.json({ logs: u.searchParams.get('text') === 'claim_success' ? [{ message: "[consultation-worker] { checkpoint: 'claim_success', claimed: 0 }", timestamp: new Date().toISOString() }] : runtime.stopAt ? [{ message: '[worker] stopped', timestamp: runtime.stopAt }] : [], hasMore: false });
    return Response.json({ ...config(id), ownerId: 'tea-daipgd67bikc739jftl0', suspended: id === FIXED.worker && runtime.suspended ? 'suspended' : 'not_suspended', serviceDetails: {} });
} if (mutation)
    return mutation(u.href, init!); throw Error('FAKE_UNEXPECTED_MUTATION'); }); const credentials = { render: 'FAKE_RENDER', management: 'FAKE_MANAGEMENT', github: 'FAKE_GITHUB', serviceRole: 'FAKE_SERVICE_ROLE',authFlowSecret:rootSecret }; const transport = createFiniteTransport(plan, { mode: 'LOCAL_MOCK', fetch, credentials }), collector = { mode: 'LOCAL_MOCK' as const, preimage, journal, localMockSource: { sha: SHA, tree: TREE, manifestSHA256: plan.sourceManifestSHA256 } }; return { plan, input, preimage, snapshot, state, runtime, journal, calls, fetch, credentials, transport, collector, getMutation: () => mutation, setMutation: (fn: typeof mutation) => { mutation = fn; } }; }
type TestSnapshot = {
    tables: Record<string, {
        columns: string[];
        rows: {
            key: string;
            full: string;
            fields: Record<string, string>;
            facts: Record<string, unknown> | null;
        }[];
    }>;
};
function addRow(snapshot: TestSnapshot, table: string, id: string, facts: Record<string, unknown>) { const fields = Object.fromEntries(snapshot.tables[table].columns.map(k => [k, digest([id, k, facts[k] ?? null])])), row = { key: digest([table, id]), full: digest(fields), fields, facts: { ...facts } }; snapshot.tables[table].rows.push(row); snapshot.tables[table].rows.sort((a, b) => a.key.localeCompare(b.key)); return row; }
function changeRow(snapshot: TestSnapshot, table: string, id: string, patch: Record<string, unknown>) { const row = snapshot.tables[table].rows.find(r => r.key === digest([table, id]))!; for (const [k, v] of Object.entries(patch))
    row.fields[k] = digest([id, k, v]); Object.assign(row.facts!, patch); row.full = digest(row.fields); return row; }
describe('future-bound source and opaque capabilities', () => {
    it('rejects old runtime SHA and widened caps, and never allocates a window', () => { const f = fixture(); expect(() => createW2Plan({ ...f.input, expectedSHA: FIXED.oldSHA })).toThrow(); expect(() => createW2Plan({ ...f.input, maximumRenderJobs: 6 })).toThrow(); expect(f.calls).toHaveLength(0); expect(f.state.window).toBeNull(); expect(Object.isFrozen(f.plan.preimage)).toBe(true); expect(() => { f.plan.preimage.webDeployId = 'dep-foreign00000000'; }).toThrow(); });
    it('builds only the three existing access and two canonical worker slots', () => { const f = fixture(), s = scope(f.plan, W); for (const p of PARTICIPANTS) {
        const h = accessJob(f.plan, s, p);
        expect(h.slot).toBe('render/access/' + p);
        expect(JSON.stringify(h)).not.toContain('SECRET');
    } expect(() => accessJob(f.plan, s, W)).toThrow(); expect(workerJob(f.plan, s, 'team_aggregate', H, null).slot).toBe('render/team_aggregate'); expect(() => workerJob(f.plan, s, 'team_ai_report', H, null)).toThrow(); expect(f.calls).toHaveLength(0); });
    it('rejects getters and symbolic iterator before invocation', () => { const f = fixture(); let hits = 0; const bad = { ...f.input }; Object.defineProperty(bad, 'treeSHA', { get() { hits++; return TREE; } }); expect(() => createW2Plan(bad)).toThrow(); const a = [] as unknown[]; Object.defineProperty(a, Symbol.iterator, { get() { hits++; return [][Symbol.iterator]; } }); expect(() => digest({ a })).toThrow(); expect(hits).toBe(0); });
    it('keeps complete env/Auth preimages opaque and preserves absent NODE_ENV', () => { const f = fixture(), c = controls(f.plan, f.preimage), s = scope(f.plan, W); for (const k of ['env-warm', 'env-restore', 'auth-add', 'auth-restore'] as const) {
        const h = c.build(k, s);
        expect(JSON.stringify(h)).not.toContain('FAKE_SECRET');
        expect(JSON.stringify(h)).not.toContain('uri_allow_list');
    } expect('NODE_ENV' in f.preimage.web).toBe(false); expect(() => controls(f.plan, { ...f.preimage, web: { ...f.preimage.web, BILLING_ENABLED: 'true' } })).toThrow(); });
});
describe('shared durable root journal', () => {
    it('shares all namespaces and survives reopen without resetting a slot', () => { const f = fixture(), base = directory(), j = openRootJournal(f.plan, { mode: 'LOCAL_MOCK', base }), s = scope(f.plan, W); for (const key of ['controls/env-warm', 'db/prepare', 'providers/' + PARTICIPANTS[0] + '/issue', 'render/access/' + PARTICIPANTS[0]]) {
        const k = key as Parameters<typeof j.reserve>[0];
        j.reserve(k, s, H);
        j.receipt(k, 'KNOWN_ACCEPTED', H);
    } expect(j.inventory().records).toBe(8); const reopened = openRootJournal(f.plan, { mode: 'LOCAL_MOCK', base }); expect(() => reopened.reserve('db/prepare', scope(f.plan, '00000000-0000-4000-8000-000000000203'), H)).toThrow(/spent/); });
    it('unknown or intent-only blocks every next mutation except one admission stop', () => { const f = fixture(), s = scope(f.plan, W); f.journal.reserve('controls/env-warm', s, H); expect(() => f.journal.reserve('controls/env-restore', s, H)).toThrow(/STOP/); f.journal.reserve('db/stop', s, H); expect(() => f.journal.reserve('db/stop', s, H)).toThrow(); });
    it('recognizes byte-pinned legacy files without moving/deleting/changing them', () => { const f = fixture(), base = directory(); mkdirSync(join(base, 'control-operations'), { mode: 0o700 }); const path = join(base, 'control-operations', 'old-attempt.json'), bytes = Buffer.from('OLD_SPENT_RECEIPT'); writeFileSync(path, bytes, { mode: 0o600 }); const j = openRootJournal(f.plan, { mode: 'LOCAL_MOCK', base, legacy: [{ path: 'control-operations/old-attempt.json', sha256: bytesDigest(bytes) }] }); expect(j.inventory().legacyFiles).toBe(1); expect(readFileSync(path)).toEqual(bytes); writeFileSync(path, 'CHANGED'); expect(() => j.inventory()).toThrow(/legacy_changed/); });
    it('rejects unknown paths, symlinks, permissive ancestors and partial evidence', () => { const f = fixture(); for (const type of ['unknown', 'symlink', 'mode']) {
        const base = directory();
        const j = openRootJournal(f.plan, { mode: 'LOCAL_MOCK', base });
        if (type === 'unknown')
            writeFileSync(join(base, 'unexpected.json'), '{}', { mode: 0o600 });
        if (type === 'symlink')
            symlinkSync('/tmp', join(base, 'unsafe'));
        if (type === 'mode')
            chmodSync(base, 0o755);
        expect(() => j.inventory()).toThrow();
    } const base = directory(), j = openRootJournal(f.plan, { mode: 'LOCAL_MOCK', base }); j.reserve('db/prepare', scope(f.plan, W), H); const p = join(base, FIXED.root, 'operator-v2/db/prepare/intent.json'); writeFileSync(p, '{'); expect(() => j.inventory()).toThrow(/malformed/); });
    it('never exposes a delete/reset/overwrite method or permits mock protected path', () => { const f = fixture(); expect(Object.keys(f.journal).sort()).toEqual(['assertSettled', 'inventory', 'read', 'receipt', 'reserve', 'terminal']); expect(() => openRootJournal(f.plan, { mode: 'LOCAL_MOCK', base: FIXED.journalBase })).toThrow(); });
});
describe('actual finite read receipts and no arbitrary HTTP', () => {
    it('collects actual fixed source/CI/env/schema/ledger/Auth evidence with no mutation', async () => { const f = fixture(), r = await collectReadiness(f.plan, null, f.transport, f.collector), summary = readinessSummary(r); expect(summary.baselineSHA256).toBe(digest(f.snapshot)); expect(f.calls.some(x => new URL(x.url).pathname.endsWith('/rpc/capture_controlled_team_w2_preservation') && x.method === 'GET' && x.body === null)).toBe(true); expect(f.calls.every(x => x.method === 'GET' || (x.url.endsWith('/database/query') && (x.body as {
        read_only: boolean;
    }).read_only || x.url.endsWith('/rpc/check_controlled_team_auth_evidence_key')))).toBe(true); expect(JSON.stringify(summary)).not.toContain('FAKE_SECRET'); expect(() => consumeReadiness({ ...r }, f.plan, 'db/prepare', null, f.transport)).toThrow(/owned/); });
    it('authenticates separately while deriving private capability/capture MACs only from the existing root and canonical context',async()=>{
        const f=fixture(),headers:Headers[]=[],bodies:string[]=[],fetch:typeof globalThis.fetch=async(input,init)=>{
            const h=new Headers(init?.headers),u=new URL(String(input));
            if(u.pathname.endsWith('/rpc/check_controlled_team_auth_evidence_key')||u.pathname.endsWith('/rpc/capture_controlled_team_w2_preservation')){
                headers.push(h);bodies.push(String(init?.body??''));expect(h.get('x-aca-w2-evidence-key')).toBe(evidenceChannelHeader(evidenceKey()));
                expect(h.get('authorization')).toBe('Bearer different-synthetic-service-role');
                if(init?.body){const b=JSON.parse(String(init.body));expect(b.p_challenge_mac).toBe(evidenceChannelMAC(evidenceKey(),['aca-w2-auth-evidence-v1','challenge',FIXED.root,'-',PARTICIPANTS[0],'b7cc06c7-056c-4fd8-b445-eeaf187cec7c','capability','-',b.p_challenge].join('\n')));}
                else{expect(u.searchParams.get('p_run_id')).toBe(FIXED.root);expect(u.searchParams.get('p_plan_sha256')).toBe(H);expect(u.searchParams.get('p_application_sha')).toBe(SHA);}
            }else expect(h.has('x-aca-w2-evidence-key')).toBe(false);
            return f.fetch(input,init);
        };
        const t=createFiniteTransport(f.plan,{mode:'READ_ONLY',fetch,credentials:{...f.credentials,serviceRole:'different-synthetic-service-role'}});
        await t.checkAuthHeaderCapability();await t.readDatabase('w2_preservation_capture_v1');await t.readAuthVersion();
        expect(headers).toHaveLength(2);expect(bodies.join('')).not.toContain(rootSecret);expect(bodies.join('')).not.toContain(evidenceChannelHeader(evidenceKey()));
        expect(()=>createFiniteTransport(f.plan,{mode:'READ_ONLY',fetch,credentials:{...f.credentials,authFlowSecret:''}})).toThrow();
    });
    it('bounded complete pagination uses cursor and rejects missing cursor', async () => { const f = fixture(); let n = 0; const fetch = vi.fn(async (input: RequestInfo | URL) => { void input; return Response.json(n++ === 0 ? Array.from({ length: 100 }, (_, i) => ({ job: { id: 'job-' + i }, cursor: 'cursor_' + i })) : [{ job: { id: 'job-last' } }]); }); const t = createFiniteTransport(f.plan, { mode: 'READ_ONLY', fetch, credentials: f.credentials }); expect(await t.readService(WEB, 'jobs')).toHaveLength(101); expect(fetch.mock.calls).toHaveLength(2); expect(String(fetch.mock.calls[1][0])).toContain('cursor=cursor_99'); const bad = createFiniteTransport(f.plan, { mode: 'READ_ONLY', fetch: vi.fn(async () => Response.json(Array.from({ length: 100 }, () => ({ job: { id: 'job' } })))), credentials: f.credentials }); await expect(bad.readService(WEB, 'jobs')).rejects.toThrow(/pagination/); });
    it('rejects arbitrary service/resource/query names without an HTTP call', async () => { const f = fixture(); await expect(f.transport.readService('srv-wrong', 'jobs')).rejects.toThrow(); await expect(f.transport.readService(WEB, 'shell' as never)).rejects.toThrow(); await expect(f.transport.readDatabase('select pg_sleep(99)' as never)).rejects.toThrow(); expect(f.calls).toHaveLength(0); });
    it('unknown mutation is durably spent and cannot issue a second POST', async () => { const f = fixture(); let posts = 0; f.setMutation(() => { posts++; throw Error('FAKE_TIMEOUT_SECRET'); }); const o = createW2Operator(f.plan, { ...f.collector, mode: 'LOCAL_MOCK', fetch: f.fetch, credentials: f.credentials }); const r = await o.observe(); o.initialize(r); await expect(o.prepare(W, r)).rejects.toThrow(/unknown_action_spent/); expect(posts).toBe(1); expect(f.journal.read('db/prepare', 'receipt')?.status).toBe('UNKNOWN_SPENT_STOP'); expect(() => o.prepare(W, r)).toThrow(); expect(o.scope?.windowId).toBe(W); expect(o.status().unresolved).toEqual(['db/prepare']); expect(posts).toBe(1); });
    it('owned reservation is consumed once; cloned reservation/capability never sends', async () => { const f = fixture(), r = await collectReadiness(f.plan, null, f.transport, f.collector), h = databaseAction(f.plan, scope(f.plan, W), 'prepare'), reservation = f.journal.reserve('db/prepare', scope(f.plan, W), h.requestSHA256); f.setMutation(() => Response.json([{ result: { status: 'prepared', run_id: FIXED.root, window_id: W, expires_at: null } }], { status: 201 })); await expect(f.transport.execute({ ...h }, reservation, r)).rejects.toThrow(/owned_capability/); expect(f.calls.filter(x => x.method === 'POST' && !x.url.endsWith('/rpc/check_controlled_team_auth_evidence_key') && !(x.body as {
        read_only?: boolean;
    })?.read_only)).toHaveLength(0); });
    it('READ_ONLY and PRODUCTION cannot reuse a mock journal or allocate real state', () => { const f = fixture(); expect(() => createW2Operator(f.plan, { ...f.collector, mode: 'READ_ONLY', fetch: f.fetch, credentials: f.credentials })).toThrow(/journal_mode/); const production = createW2Plan({ ...f.input, authorization: 'EXPLICIT_OWNER_W2_EXECUTION' }); expect(() => createW2Operator(production, { ...f.collector, mode: 'PRODUCTION', fetch: f.fetch, credentials: f.credentials })).toThrow(/journal_mode/); expect(() => createW2Operator(f.plan, { ...f.collector, journal: { ...f.journal }, mode: 'LOCAL_MOCK', fetch: f.fetch, credentials: f.credentials })).toThrow(/journal_mode/); expect(f.calls).toHaveLength(0); });
});
describe('freshness, private proof and finite containment', () => {
    it('returns deep frozen nonsecret proof; mutations cannot alter owned observations', async () => { const f = fixture(), r = await collectReadiness(f.plan, null, f.transport, f.collector), p = observedReadiness(r, f.plan, null, f.transport); expect(Object.isFrozen(p.state)).toBe(true); expect(Object.isFrozen(p.services[0])).toBe(true); expect(JSON.stringify(p)).not.toContain('FAKE_SECRET'); expect('preimage' in p).toBe(false); expect('auth' in p).toBe(false); expect('environment' in p.services[0]).toBe(false); expect(() => { p.state.publicEligible = 1; }).toThrow(); expect(() => { p.services.push(p.services[0]); }).toThrow(); expect(consumeReadiness(r, f.plan, 'db/prepare', null, f.transport).state.publicEligible).toBe(0); });
    it('blocks foreign web env or Auth fields before an intent or production write', async () => { for (const field of ['env', 'auth']) {
        const f = fixture();
        if (field === 'env')
            Object.assign(f.runtime.webEnvironment, { FOREIGN: 'drift' });
        else
            Object.assign(f.runtime.auth, { external_email_enabled: false });
        const o = createW2Operator(f.plan, { ...f.collector, mode: 'LOCAL_MOCK', fetch: f.fetch, credentials: f.credentials }), r = await o.observe();
        expect(() => o.initialize(r)).toThrow(/stage_env_auth/);
        expect(f.journal.inventory().records).toBe(0);
        expect(f.calls.some(x => (x.body as {
            read_only?: boolean;
        })?.read_only === false)).toBe(false);
    } });
    it('rejects truncated CI and traversal or incomplete source manifests before effects', async () => { const f = fixture(); for (const sourceManifest of [{ ...f.input.sourceManifest, 'scripts/../escape.ts': H }, { 'scripts/operator-w2/operator.ts': H }])
        expect(() => createW2Plan({ ...f.input, sourceManifest, sourceManifestSHA256: digest(sourceManifest) })).toThrow(/source_manifest/); const fetch: typeof globalThis.fetch = async (i, o) => String(i).includes('check-runs') ? Response.json({ total_count: 101, check_runs: [] }) : f.fetch(i, o); const t = createFiniteTransport(f.plan, { mode: 'LOCAL_MOCK', fetch, credentials: f.credentials }); await expect(collectReadiness(f.plan, null, t, f.collector)).rejects.toThrow(/main_ci/); expect(f.journal.inventory().records).toBe(0); });
    it('binds all read receipts to the exact concrete transport, rejecting structural and cross-instance proofs', async () => { const f = fixture(), foreign = createFiniteTransport(f.plan, { mode: 'LOCAL_MOCK', fetch: f.fetch, credentials: f.credentials }), r = await collectReadiness(f.plan, null, foreign, f.collector); expect(() => consumeReadiness(r, f.plan, 'db/prepare', null, f.transport)).toThrow(/owned_readiness/); await expect(collectReadiness(f.plan, null, { ...f.transport }, f.collector)).rejects.toThrow(/owned_finite_transport/); });
    it('captures transport mode and fetch immutably against caller option mutation', async () => { const f = fixture(), options = { mode: 'READ_ONLY' as 'READ_ONLY' | 'LOCAL_MOCK', fetch: f.fetch, credentials: { ...f.credentials } }, t = createFiniteTransport(f.plan, options), replacement = vi.fn(async () => Response.json({ unexpected: true })); options.mode = 'LOCAL_MOCK'; options.fetch = replacement; options.credentials.serviceRole = 'CHANGED_FAKE_KEY'; await t.readService(WEB, 'service'); expect(t.mode).toBe('READ_ONLY'); expect(replacement).not.toHaveBeenCalled(); expect(f.calls).toHaveLength(1); });
    it('denies advertised Auth-version drift before any window or provider reservation', async () => { const f = fixture(), fetch: typeof globalThis.fetch = async (i,o) => String(i).endsWith('/auth/v1/health') ? Response.json({version:'v2.198.0',name:'GoTrue',description:'GoTrue is a user registration and authentication API'}) : f.fetch(i,o), transport = createFiniteTransport(f.plan,{mode:'LOCAL_MOCK',fetch,credentials:f.credentials}); await expect(collectReadiness(f.plan,null,transport,f.collector)).rejects.toThrow(/contract/); expect(f.journal.inventory().records).toBe(0); expect(f.calls).toHaveLength(0); });
    it('caps streamed response bytes before buffering and cancels an oversized body without a retry', async () => { const f=fixture();let chunks=0,canceled=0;const fetch=vi.fn(async()=>new Response(new ReadableStream<Uint8Array>({pull(controller){chunks++;controller.enqueue(new Uint8Array(65536));},cancel(){canceled++;}}))),transport=createFiniteTransport(f.plan,{mode:'READ_ONLY',fetch,credentials:f.credentials});await expect(transport.readService(WEB,'service')).rejects.toThrow('w2_operator_transport_unknown_STOP');expect(chunks).toBeLessThanOrEqual(259);expect(canceled).toBe(1);expect(fetch).toHaveBeenCalledTimes(1); });
    it('refuses a prolonged observation even if the final snapshots look recent', async () => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-24T20:00:00Z')); const f = fixture(); let advanced = false; const fetch: typeof globalThis.fetch = async (i, o) => { if (!advanced && String(i).includes('api.github.com')) {
        advanced = true;
        vi.setSystemTime(new Date('2026-10-24T20:01:01Z'));
    } return f.fetch(i, o); }; const t = createFiniteTransport(f.plan, { mode: 'LOCAL_MOCK', fetch, credentials: f.credentials }); await expect(collectReadiness(f.plan, null, t, f.collector)).rejects.toThrow(/observation_frame/); expect(f.journal.inventory().records).toBe(0); });
    it('retains ambiguous prepare scope, sends only one fixed stop, and holds without recovery/reset', async () => { const f = fixture(); let posts = 0; f.setMutation((url) => { posts++; if (url.includes('/database/query')) {
        f.state.window = { id: W, approved_plan_hash: H, status: 'prepared', armed_at: null, expires_at: null };
        throw Error('FAKE_AMBIGUOUS');
    } if (url.endsWith('/rpc/stop_controlled_team_window')) {
        f.state.window!.status = 'stopped';
        return Response.json({ status: 'stopped', run_id: FIXED.root, window_id: W });
    } throw Error('FAKE_UNEXPECTED'); }); const o = createW2Operator(f.plan, { ...f.collector, mode: 'LOCAL_MOCK', fetch: f.fetch, credentials: f.credentials }), r = await o.observe(); o.initialize(r); await expect(o.prepare(W, r)).rejects.toThrow(/unknown_action/); expect(o.scope?.windowId).toBe(W); const next = await o.observe(); await o.stop(next); expect(posts).toBe(2); expect(o.status().unresolved).toEqual(['db/prepare']); expect(f.journal.read('db/prepare', 'receipt')?.status).toBe('UNKNOWN_SPENT_STOP'); expect(() => o.closure(next)).toThrow(/unresolved/); await expect(o.control('env-restore', next)).rejects.toThrow(); expect(posts).toBe(2); });
});
function acceptFiniteControls(f: ReturnType<typeof fixture>) { f.setMutation((url, init) => { const u = new URL(url), body = typeof init.body === 'string' ? JSON.parse(init.body) : null, at = new Date().toISOString(); if (u.pathname.endsWith('/database/query')) {
    const preparing = body.query.includes('configure_controlled_team_w2');
    if (preparing) {
        const facts = { id: W, root_run_id: FIXED.root, status: 'prepared', approved_plan_hash: H, created_at: at, armed_at: null, expires_at: null, personal_deadline_at: null, stopped_at: null, stop_reason: null, expected_subscription_id: FIXED.freeSubscription, grant_subscription_id: null, restored_subscription_id: null, report_id: null, source_fingerprint: null, aggregate_claimed: false, ai_claimed: false, generation_deadline: null };
        f.state.window = { ...facts };
        addRow(f.snapshot, 'private.controlled_team_windows', W, facts);
    }
    else {
        const patch = { status: 'active', armed_at: at, expires_at: new Date(Date.now() + 3600000).toISOString(), personal_deadline_at: new Date(Date.now() + 1200000).toISOString() };
        Object.assign(f.state.window!, patch);
        changeRow(f.snapshot, 'private.controlled_team_windows', W, patch);
    }
    return Response.json([{ result: { status: preparing ? 'prepared' : 'active', run_id: FIXED.root, window_id: W, expires_at: f.state.window!.expires_at } }]);
} if (u.pathname.endsWith('/config/auth')) {
    Object.assign(f.runtime.auth, body);
    return Response.json(f.runtime.auth);
} if (u.pathname.endsWith('/env-vars')) {
    Object.keys(f.runtime.webEnvironment).forEach(k => delete (f.runtime.webEnvironment as Record<string, string>)[k]);
    Object.assign(f.runtime.webEnvironment, Object.fromEntries(body.map((x: {
        key: string;
        value: string;
    }) => [x.key, x.value])));
    return Response.json([]);
} if (u.pathname.endsWith('/deploys')) {
    f.runtime.webDeployId = f.runtime.webEnvironment.TEAM_ENABLED === 'true' ? 'dep-warm00000000' : 'dep-restore00000000';
    return Response.json({ id: f.runtime.webDeployId, commit: { id: SHA } });
} if (u.pathname.endsWith('/suspend')) {
    f.runtime.suspended = true;
    f.runtime.stopAt = at;
    return new Response(null, { status: 202 });
} if (u.pathname.endsWith('/resume')) {
    f.runtime.suspended = false;
    f.runtime.instanceId = FIXED.worker + '-new12';
    f.runtime.workerDeployId = 'dep-resumed00000000';
    f.runtime.workerTrigger = 'service_resumed';
    f.runtime.workerDeployCreatedAt = at;
    return new Response(null, { status: 202 });
} if (u.pathname.endsWith('/stop_controlled_team_window')) {
    const patch = { status: 'stopped', stopped_at: at, stop_reason: 'w2_operator_stop' };
    Object.assign(f.state.window!, patch);
    changeRow(f.snapshot, 'private.controlled_team_windows', W, patch);
    return Response.json({ status: 'stopped', run_id: FIXED.root, window_id: W });
} throw Error('FAKE_UNEXPECTED_FINITE_ACTION'); }); }
function actualManualCAS(f: ReturnType<typeof fixture>, direction: 'advanced' | 'free') { const at = new Date().toISOString(), old = f.state.subscriptions.find(x => x.status === 'active')!, id = direction === 'advanced' ? '10000000-0000-4000-8000-000000000001' : '10000000-0000-4000-8000-000000000002'; changeRow(f.snapshot, 'private.account_subscriptions', old.id, { status: 'ended', effective_until: at, updated_at: at }); old.status = 'ended'; f.state.subscriptions.push({ id, plan: direction, status: 'active', source: 'manual' }); addRow(f.snapshot, 'private.account_subscriptions', id, { id, account_id: FIXED.account, plan_key: direction, status: 'active', source: 'manual', effective_until: null, providerFieldsNull: true, effective_from: at, created_at: at }); const patch = { expected_subscription_id: id, [direction === 'advanced' ? 'grant_subscription_id' : 'restored_subscription_id']: id }; Object.assign(f.state.window!, patch); changeRow(f.snapshot, 'private.controlled_team_windows', W, patch); const audit = { id: 'plan-' + direction, actor: 'dea5f776-1923-4e8d-9042-d3ffbb1d8833', oldPlan: direction === 'advanced' ? 'free' : 'advanced', newPlan: direction, subscription: id, createdAt: at }; (f.state.planChanges as unknown[]).push(audit); addRow(f.snapshot, 'private.admin_plan_changes', audit.id, { account_id: FIXED.account, old_plan: audit.oldPlan, new_plan: direction, administrator_user_id: audit.actor, subscription_id: id, source: 'manual', created_at: at }); addRow(f.snapshot, 'private.audit_events', audit.id, { actor_id: audit.actor, subject_id: FIXED.account, action: 'account_plan_changed', created_at: at }); }
describe('actual fake-HTTP control and manual-entitlement lifecycle', () => {
    it('prepares unarmed, warms exactly, proves stop/drains, arms once, contains, restores Free+fullpreimages and resumes actual new idle worker', async () => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-24T20:00:00Z')); const f = fixture(); acceptFiniteControls(f); const o = createW2Operator(f.plan, { ...f.collector, mode: 'LOCAL_MOCK', fetch: f.fetch, credentials: f.credentials }); o.initialize(await o.observe()); const settle = async () => { const r = await o.observe(); expect(o.settle(r).status).toBe('PASS'); return r; }; await o.prepare(W, await o.observe()); await settle(); for (const action of ['auth-add', 'env-warm', 'web-deploy-warm', 'worker-suspend'] as const) {
        await o.control(action, await o.observe());
        await settle();
    } const foreignD1 = await collectReadiness(f.plan, o.scope, f.transport, f.collector), d1 = await o.observe(); vi.setSystemTime(new Date(Date.now() + 15000)); const d2 = await o.observe(), foreignD2 = await collectReadiness(f.plan, o.scope, f.transport, f.collector), drains = [d1, d2] as const; await expect(o.arm(await o.observe([foreignD1, foreignD2]))).rejects.toThrow(/global_drain/); expect(f.journal.read('db/arm', 'intent')).toBeUndefined(); await o.arm(await o.observe(drains)); await settle(); o.reserveManualCAS('advanced', await o.observe()); actualManualCAS(f, 'advanced'); expect(o.settleManualCAS(await o.observe()).status).toBe('PASS'); await o.stop(await o.observe()); await settle(); o.reserveManualCAS('free', await o.observe()); actualManualCAS(f, 'free'); expect(o.settleManualCAS(await o.observe()).status).toBe('PASS'); for (const action of ['env-restore', 'auth-restore', 'web-deploy-restore'] as const) {
        await o.control(action, await o.observe());
        await settle();
    } await o.control('worker-resume', await o.observe(drains)); await settle(); const closure = o.closure(await o.observe()); expect(closure.status).toBe('W2_CONTAINED_PRESERVED_GATES_OFF_INCOMPLETE'); expect(closure.productionBilling).toBe('OFF'); expect(f.runtime.webEnvironment).toEqual(f.preimage.web); expect(f.runtime.auth).toEqual(f.preimage.auth); expect(f.state.subscriptions.filter(x => x.status === 'active').map(x => x.plan)).toEqual(['free']); expect(f.calls.filter(x => x.url.includes('api.render.com') && x.method === 'POST')).toHaveLength(4); expect(f.calls.some(x => /api.openai.com|api.resend.com|yookassa/.test(x.url))).toBe(false); expect(o.status()).toMatchObject({ pending: null, interrupted: [], unresolved: [] }); });
    it('preserves accepted prepare history when stopping before its settlement, and refuses false closure', async () => { const f = fixture(); acceptFiniteControls(f); const o = createW2Operator(f.plan, { ...f.collector, mode: 'LOCAL_MOCK', fetch: f.fetch, credentials: f.credentials }); o.initialize(await o.observe()); await o.prepare(W, await o.observe()); await o.stop(await o.observe()); expect(o.status().interrupted).toEqual(['db/prepare']); expect(f.journal.read('db/prepare', 'receipt')?.status).toBe('KNOWN_ACCEPTED'); expect(() => o.closure(awaitNever())).toThrow(/unresolved/); function awaitNever() { return {} as Awaited<ReturnType<typeof o.observe>>; } });
});
function localFixtureCommitment() { const value = { version: 1, status: 'LOCAL_UNUSED_SYNTHETIC_PREPARATION', scope: { canonicalSHA: FIXED.oldSHA, rootRunId: FIXED.root, teamId: FIXED.team, methodologyVersionId: '310c53d3-91bf-4501-ac6a-0cd41771a7ef' }, createdAt: '2026-10-24T20:00:00Z', profiles: [-1, 0, 1].map(abstractProfile => ({ abstractProfile, controls: Array.from({ length: 84 }, (_, i) => ({ questionId: `50000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, tagName: i < 80 ? 'SELECT' : 'TEXTAREA', value: i < 80 ? String(abstractProfile + 2) : 'Вымышленный ответ.' })) })), datasetSHA256: '', assignment: PARTICIPANTS.map((participantId, i) => ({ participantId, abstractProfile: i - 1 })), saltHex: H }; value.datasetSHA256 = bytesDigest(Buffer.from(fixtureCanonicalJSON(value.profiles))); const commitment = bytesDigest(Buffer.from('AI-COMPANY-AUDIT/V27/W2/UNUSED-FIXTURE-ASSIGNMENT/V1\0' + fixtureCanonicalJSON({ ...value.scope, createdAt: value.createdAt, datasetSHA256: value.datasetSHA256, participantIds: PARTICIPANTS, assignment: value.assignment, saltHex: H }))), bytes = Buffer.from(JSON.stringify(value)); return createLocalMockFixture(bytes, { assignmentCommitmentSHA256: commitment, datasetSHA256: value.datasetSHA256, privateFileSHA256: bytesDigest(bytes) }); }
function applyPairDelta(f: ReturnType<typeof fixture>, pair: {
    b: PreservationSnapshot;
    a: PreservationSnapshot;
}, participant = 0, answersHMAC?: string) {
    const replacements = new Map<string, string>([[pf.W, W], [pf.PLAN, H], [COHORT[0].participantId, PARTICIPANTS[participant]], [COHORT[0].userId, COHORT[participant].userId], [pf.NOW, new Date().toISOString()], [pf.REPORT, pf.REPORT], ...['issue-trace', 'issue-effect', 'email-effect', 'verify-trace', 'verify-reservation', 'new-session', 'new-refresh', 'new-amr', 'new-account', 'new-membership', 'default-free', 'identity', 'finalizer-audit', 'verify-rate', 'save-rate', 'ott'].map(x => [x, x + '-' + participant] as [
            string,
            string
        ])]);
    const convert = (v: unknown): unknown => typeof v === 'string' ? (replacements.get(v) ?? v) : Array.isArray(v) ? v.map(convert) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, convert(x)])) : v;
    const match = (table: string, facts: Record<string, unknown>) => f.snapshot.tables[table].rows.filter(r => { const a = r.facts!; if (facts.id !== undefined)
        return a.id === facts.id; if (table === 'private.team_responses' || table === 'private.team_invitations')
        return a.participant_id === facts.participant_id; if (table === 'private.team_identity_reservations')
        return a.user_id === facts.user_id; if (table === 'public.rate_limit_windows')
        return a.participant_id === facts.participant_id && a.rateKind === facts.rateKind; if (facts.uid !== undefined)
        return a.uid === facts.uid && (facts.token_type === undefined || a.token_type === facts.token_type); return false; });
    for (const table of CAPTURE_TABLES) {
        const before = new Map(pair.b.tables[table].rows.map(r => [r.key, r])), after = new Map(pair.a.tables[table].rows.map(r => [r.key, r]));
        for (const key of new Set([...before.keys(), ...after.keys()])) {
            const old = before.get(key), next = after.get(key);
            if (old && next && digest(old) === digest(next))
                continue;
            if (!old && next) {
                const row = structuredClone(next);
                row.key = digest([table, key, participant]);
                row.facts = convert(next.facts) as Record<string, unknown>;
                f.snapshot.tables[table].rows.push(row);
                continue;
            }
            const facts = convert(old!.facts) as Record<string, unknown>, targets = match(table, facts);
            expect(targets.length, table + ':actual scoped row').toBe(1);
            const target = targets[0];
            if (!next) {
                f.snapshot.tables[table].rows = f.snapshot.tables[table].rows.filter(r => r !== target);
                continue;
            }
            for (const k of Object.keys(old!.fields))
                if (old!.fields[k] !== next.fields[k])
                    target.fields[k] = k === 'answers' && answersHMAC ? answersHMAC : next.fields[k];
            for (const [k, v] of Object.entries(next.facts!))
                if (digest(v) !== digest(old!.facts?.[k] ?? null))
                    target.facts![k] = convert(v);
            target.full = digest(target.fields);
        }
    }
    for (const table of CAPTURE_TABLES)
        f.snapshot.tables[table].rows.sort((a, b) => a.key.localeCompare(b.key));
    f.snapshot.wireTraces = f.snapshot.tables['private.controlled_team_auth_wire'].rows.map(r => Object.fromEntries(pf.traceKeys.map(k => [k, r.facts![k]]))) as never[];
    const window = f.snapshot.tables['private.controlled_team_windows'].rows[0];
    if (window)
        Object.assign(f.state.window!, window.facts);
}
it('completes three owned fake access+personal verify+committed answers, aggregate, report and PDF without issuing extra providers', async () => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-24T20:00:00Z')); const f = fixture(), snap = f.snapshot as PreservationSnapshot; for (let i = 0; i < 3; i++) {
    pf.pending(snap, i);
    pf.add(snap, 'private.team_identity_reservations', 'identity-' + i, { user_id: COHORT[i].userId, finalized_at: null, invitationMatches: true });
    pf.add(snap, 'private.team_invitations', PARTICIPANTS[i], { participant_id: PARTICIPANTS[i], redeemed_at: null });
    pf.add(snap, 'public.team_participants', PARTICIPANTS[i], { id: PARTICIPANTS[i], team_diagnostic_id: FIXED.team, status: 'invited', started_at: null, completed_at: null });
} const fixtureHandle = localFixtureCommitment(), plan = createW2Plan({ ...f.input, fixtureCommitmentSHA256: fixtureHandle.assignmentCommitmentSHA256, finalBaselineSHA256: captureFingerprint(snap) }), journal = openRootJournal(plan, { mode: 'LOCAL_MOCK', base: directory() }), credentials = { ...f.credentials, serviceRole: 'fake_existing_key_for_local_tests_only' }; acceptFiniteControls(f); const controlsMutation = f.getMutation()!; let accessIndex = 0; f.setMutation((url, init) => { if (!url.endsWith('/jobs'))
    return controlsMutation(url, init); const body = JSON.parse(String(init.body)), access = url.includes(WEB), id = 'job-' + (access ? 'access0000000' + accessIndex : 'worker0000000' + f.runtime.workerJobs.length), at = new Date().toISOString(); if (access) {
    applyPairDelta(f, pf.issued(), accessIndex++);
}
else if (f.runtime.workerJobs.length === 0) {
    applyPairDelta(f, pf.aggregatePair());
    f.state.teamEligible = 0;
    (f.state.targetJobs as unknown as Record<string, unknown>[])[0].status = 'completed';
}
else {
    applyPairDelta(f, pf.reportPair());
    f.state.teamEligible = 0;
    (f.state.targetJobs as unknown as Record<string, unknown>[]).at(-1)!.status = 'completed';
} const job = { id, serviceId: access ? WEB : FIXED.worker, planId: FIXED.planId, startCommand: body.startCommand, status: 'succeeded', startedAt: at, finishedAt: at }; (access ? f.runtime.webJobs : f.runtime.workerJobs).push(job); return Response.json(job); }); const o = createW2Operator(plan, { mode: 'LOCAL_MOCK', fetch: f.fetch, credentials, preimage: f.preimage, journal, localMockSource: f.collector.localMockSource }); o.initialize(await o.observe()); const settle = async () => expect(o.settle(await o.observe()).status).toBe('PASS'); await o.prepare(W, await o.observe()); await settle(); for (const action of ['auth-add', 'env-warm', 'web-deploy-warm', 'worker-suspend'] as const) {
    await o.control(action, await o.observe());
    await settle();
} let d1 = await o.observe(); vi.setSystemTime(new Date(Date.now() + 15000)); let d2 = await o.observe(); await o.arm(await o.observe([d1, d2])); await settle(); o.reserveManualCAS('advanced', await o.observe()); actualManualCAS(f, 'advanced'); o.settleManualCAS(await o.observe()); for (const id of PARTICIPANTS) {
    await o.access(id, await o.observe([d1, d2]));
    await settle();
} for (let i = 0; i < 3; i++) {
    o.reservePersonalVerification(PARTICIPANTS[i], await o.observe());
    applyPairDelta(f, pf.verification(), i);
    expect(o.settleHuman(await o.observe()).status).toBe('PASS');
} for (let i = 0; i < 3; i++) {
    if (i === 2) {
        d1 = await o.observe();
        vi.setSystemTime(new Date(Date.now() + 15000));
        d2 = await o.observe();
    }
    o.reserveAnswers(PARTICIPANTS[i], await o.observe(), fixtureHandle);
    const expected = fixtureAnswerExpectation(fixtureHandle, PARTICIPANTS[i], evidenceKey());
    applyPairDelta(f, pf.answerPair(), i, expected.answersHMAC);
    (f.state.cohort[i] as {
        status: string;
    }).status = 'completed';
    if (i === 2) {
        const j = pf.job(snap);
        j.facts!.controlled_window_id = W;
        j.facts!.created_at = new Date().toISOString();
        j.facts!.available_at = new Date().toISOString();
        f.state.teamEligible = 1;
        (f.state.targetJobs as unknown as Record<string, unknown>[]).push({ id: pf.JOB, kind: 'team_aggregate', team: FIXED.team, source: pf.SOURCE, window: W, root: FIXED.root, status: 'queued', attempts: 0, hasLease: false, createdAt: new Date().toISOString() });
    }
    expect(o.settleHuman(await o.observe()).status).toBe('PASS');
} await o.worker('team_aggregate', await o.observe([d1, d2])); await settle(); d1 = await o.observe(); vi.setSystemTime(new Date(Date.now() + 15000)); d2 = await o.observe(); o.reserveReportRequest(await o.observe()); applyPairDelta(f, pf.reportRequestPair()); f.state.teamEligible = 1; (f.state.targetJobs as unknown as Record<string, unknown>[]).push({ id: 'report-job', kind: 'team_ai_report', team: FIXED.team, source: pf.SOURCE, window: W, root: FIXED.root, status: 'queued', attempts: 0, hasLease: false, createdAt: new Date().toISOString() }); expect(o.settleHuman(await o.observe()).status).toBe('PASS'); await o.worker('team_ai_report', await o.observe([d1, d2])); await settle(); o.reservePDF(await o.observe()); applyPairDelta(f, pf.pdfPair()); expect(o.settleHuman(await o.observe()).status).toBe('PASS'); await o.stop(await o.observe()); await settle(); o.reserveManualCAS('free', await o.observe()); actualManualCAS(f, 'free'); o.settleManualCAS(await o.observe()); for (const action of ['env-restore', 'auth-restore', 'web-deploy-restore'] as const) {
    await o.control(action, await o.observe());
    await settle();
} await o.control('worker-resume', await o.observe([d1, d2])); await settle(); expect(o.closure(await o.observe()).status).toBe('W2_SMOKE_CLOSED_PRESERVED_AWAITING_OWNER_REVIEW'); expect(f.runtime.webJobs).toHaveLength(3); expect(f.runtime.workerJobs).toHaveLength(2); expect(f.calls.some(x => /api.openai.com|api.resend.com|yookassa/.test(x.url))).toBe(false); expect(journal.read('db/pdf', 'terminal')?.status).toBe('TERMINAL_SUCCEEDED'); }, 30000);
