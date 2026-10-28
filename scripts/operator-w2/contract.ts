import { createHash } from 'node:crypto';
import { z } from 'zod';
export const FIXED = Object.freeze({ root: 'e3623f1d-2da0-4dfe-b600-d747f529c5fc', team: '8383647f-10d9-45f9-8c76-f22cf357074b', account: 'af1b67c8-5c92-4300-92e2-d666ca75c3cd', freeSubscription: '55a94709-c244-44f5-aafe-6ed49a1b83cc', oldSHA: 'c3758f58742b5db0890f5cdec9eec2ead892d99a', web: 'srv-dak57did0e5s73b1t0b0', worker: 'srv-dak5rurl550s73a17l60', project: 'fhvxqeaujjeiflanqsbg', origin: 'https://audit.iteam.ru', callback: 'https://audit.iteam.ru/ru/team/join', planId: 'plan-srv-006', journalBase: '/private/tmp/aca-v27-controlled-team' });
export const WEB = FIXED.web;
export const PARTICIPANTS = ['0ae17418-e97a-46c7-9000-c13580f72506', '231f0ccf-ee6d-4955-9940-9188914dab75', '556b1e8e-346f-4990-96af-e621950f20e3'] as const;
export const OLD_EFFECTS = ['3664f153-62f9-4579-b62d-efb204e2c37f', 'f573cacb-f05a-43c0-9f88-d9b206e97abe', '9e75ce9a-d813-450b-8931-58d7bb52f5e0', '507ed4a0-d5d0-427a-9253-e907bbbae1f2', '9776135f-05af-4869-9922-93ecd41512c0', '34d7bc81-8c5b-45fb-82e6-f12956f48c41'] as const;
export const OFF = ['ACQUISITION_ENABLED', 'ACQUISITION_START_ENABLED', 'TEAM_CREATION_ENABLED', 'TEAM_INVITATIONS_ENABLED', 'BILLING_ENABLED', 'YOOKASSA_REFUNDS_ENABLED', 'YOOKASSA_RECONCILIATION_ENABLED'] as const;
export const CONTROL_SLOTS = ['auth-add', 'env-warm', 'web-deploy-warm', 'worker-suspend', 'env-restore', 'auth-restore', 'web-deploy-restore', 'worker-resume'] as const;
export const DB_SLOTS = ['prepare', 'arm', 'stop', 'terminalize-aggregate', 'terminalize-report', 'grant-cas', 'free-cas'] as const;
export const ALL_SLOTS = [...CONTROL_SLOTS.map(x => `controls/${x}`), ...DB_SLOTS.map(x => `db/${x}`), ...PARTICIPANTS.map(x => `db/answers/${x}`), 'db/request-report', 'db/pdf', ...PARTICIPANTS.map(x => `render/access/${x}`), 'render/team_aggregate', 'render/team_ai_report', ...PARTICIPANTS.flatMap(x => [`providers/${x}/issue`, `providers/${x}/verify`, `providers/${x}/email`])] as const;
export type Slot = (typeof ALL_SLOTS)[number];
export const hex = z.string().regex(/^[a-f0-9]{64}$/), sha = z.string().regex(/^[a-f0-9]{40}$/), instant = z.iso.datetime({ offset: true });
export function need(condition: unknown, code: string): asserts condition { if (!condition)
    throw Error('w2_operator_' + code); }
export function assertData(value: unknown, depth = 0): void { need(depth <= 20, 'data_depth'); if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value))
    return; need(value && typeof value === 'object', 'data_only'); if (Array.isArray(value)) {
    need(Object.getPrototypeOf(value) === Array.prototype && Reflect.ownKeys(value).every(k => typeof k === 'string'), 'array_symbols');
    for (const d of Object.values(Object.getOwnPropertyDescriptors(value)))
        need(Object.hasOwn(d, 'value'), 'getter');
    for (const x of value)
        assertData(x, depth + 1);
    return;
} need(Object.getPrototypeOf(value) === Object.prototype && Reflect.ownKeys(value).every(k => typeof k === 'string'), 'plain'); for (const d of Object.values(Object.getOwnPropertyDescriptors(value))) {
    need(Object.hasOwn(d, 'value'), 'getter');
    assertData(d.value, depth + 1);
} }
export function parse<T>(schema: z.ZodType<T>, value: unknown): T { assertData(value); const r = schema.safeParse(value); need(r.success, 'contract'); return r.data; }
function canonical(v: unknown): string { if (v === null || typeof v !== 'object')
    return JSON.stringify(v); if (Array.isArray(v))
    return '[' + v.map(canonical).join(',') + ']'; return '{' + Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => JSON.stringify(k) + ':' + canonical(x)).join(',') + '}'; }
export function digest(value: unknown) { assertData(value); return createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex'); }
export function bytesDigest(value: Uint8Array) { return createHash('sha256').update(value).digest('hex'); }
export function fresh(at: string, now = Date.now(), max = 60000) { const t = Date.parse(at); need(Number.isFinite(t) && t <= now && now - t <= max, 'stale_or_future'); return t; }
export const REQUIRED_SOURCE_FILES = [
    'src/server/team/evidence-channel-key.ts', 'src/server-runtime/team-evidence-channel.ts', 'src/server/team/controlled-auth-transport.ts', 'src/server/team/auth-wire-contract.ts', 'src/server-runtime/team-auth-evidence.ts', 'src/server-runtime/team-w2-access.ts', 'src/server-runtime/team-smoke.ts', 'src/server/team/controlled-access-runner.ts', 'src/server/team/controlled-window-dispatch.ts', 'src/server/team/controlled-manifest.ts', 'src/server/team/controlled-runner.ts', 'src/server/team/controlled-ai-transport.ts', 'src/server/team/invitation-email.ts', 'src/server/team/single-email-actions.ts', 'scripts/controlled-team-w2-access.ts', 'scripts/controlled-team-worker.ts',
    'scripts/operator-w2/contract.ts', 'scripts/operator-w2/journal.ts', 'scripts/operator-w2/legacy.ts', 'scripts/operator-w2/capabilities.ts', 'scripts/operator-w2/read-queries.ts', 'scripts/operator-w2/readiness.ts', 'scripts/operator-w2/operator.ts', 'scripts/operator-w2/capture-queries.ts', 'scripts/operator-w2/preservation.ts', 'scripts/operator-w2/fixture.ts'
] as const;
const planSchema = z.strictObject({ version: z.literal(1), authorization: z.enum(['LOCAL_MOCK_ONLY', 'EXPLICIT_OWNER_W2_EXECUTION']), rootId: z.literal(FIXED.root), teamId: z.literal(FIXED.team), expectedSHA: sha.refine(x => x !== FIXED.oldSHA), treeSHA: sha, planSHA256: hex, sourceManifest: z.record(z.string().regex(/^(?:src|scripts)\/[A-Za-z0-9_./-]+\.ts$/), hex), sourceManifestSHA256: hex, oldEffectsSHA256: hex, finalBaselineSHA256: hex, fixtureCommitmentSHA256: hex, clockSkewSeconds: z.union([z.literal(0), z.literal(2)]), clockPolicyApproved: z.boolean(), preimage: z.strictObject({ webDeployId: z.string().regex(/^dep-[a-z0-9]{8,100}$/), workerDeployId: z.string().regex(/^dep-[a-z0-9]{8,100}$/), webEnvSHA256: hex, workerEnvSHA256: hex, authConfigSHA256: hex, webConfigSHA256: hex, workerConfigSHA256: hex, webOneoffsSHA256: hex, workerOneoffsSHA256: hex }), maximumRenderJobs: z.literal(5), maximumAccessJobs: z.literal(3), maximumAuthLinks: z.literal(3), maximumVerifications: z.literal(3), maximumModelGET: z.literal(1), maximumResponses: z.literal(4), maximumResponseOutputParameterSum: z.literal(32000), maximumEmails: z.literal(3), maximumAggregate: z.literal(1), maximumReport: z.literal(1), maximumPDF: z.literal(1), maximumWebDeploys: z.literal(2), maximumEnvWrites: z.literal(2), maximumAuthConfigWrites: z.literal(2), maximumSuspend: z.literal(1), maximumResume: z.literal(1), maximumManualWorkerDeploy: z.literal(0) });
export type W2Plan = Readonly<z.infer<typeof planSchema>>;
export function createW2Plan(input: unknown): W2Plan { const p = parse(planSchema, input); need(Object.keys(p.sourceManifest).every(n => !n.split('/').includes('..')) && REQUIRED_SOURCE_FILES.every(n => Object.hasOwn(p.sourceManifest, n)) && (p.clockSkewSeconds === 0 || p.clockPolicyApproved) && digest(p.sourceManifest) === p.sourceManifestSHA256, 'source_manifest'); const freeze = (v: unknown): void => { if (v && typeof v === 'object') {
    for (const x of Object.values(v))
        freeze(x);
    Object.freeze(v);
} }; freeze(p); return p; }
export type Scope = Readonly<{
    windowId: string;
    planSHA256: string;
    expectedSHA: string;
}>;
export function scope(plan: W2Plan, windowId: string): Scope { return Object.freeze({ windowId: z.uuid().parse(windowId), planSHA256: plan.planSHA256, expectedSHA: plan.expectedSHA }); }
export function slot(input: string): Slot { need((ALL_SLOTS as readonly string[]).includes(input), 'finite_slot'); return input as Slot; }
export function assertEnvironment(e: Record<string, string>, foundation: 'true' | 'false') { need(OFF.every(k => e[k] === 'false') && e.TEAM_ENABLED === foundation && !e.YOOKASSA_SECRET_KEY && e.APP_URL === FIXED.origin && e.SUPABASE_URL === `https://${FIXED.project}.supabase.co` && (e.NODE_ENV === undefined || e.NODE_ENV === 'production'), 'environment'); }
