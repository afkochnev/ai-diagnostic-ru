/** Pure, finite diagnostic projections. This offline helper has no transport,
 * credential reader or journal authority. Rejection never exports input data. */
import { createHash } from 'node:crypto';
import { types } from 'node:util';

export const PROJECTION_DIAGNOSTIC_CODES = Object.freeze([
    'EXPECTED_BINDING', 'JOB_CONTAINER', 'JOB_ENVELOPE', 'JOB_FIELDS',
    'JOB_ID', 'JOB_SERVICE', 'JOB_PLAN', 'JOB_STATUS',
    'JOB_START_COMMAND_TYPE', 'JOB_START_COMMAND_BINDING',
    'JOB_STARTED_AT_FORMAT', 'JOB_STARTED_AT_BINDING',
    'JOB_FINISHED_AT_FORMAT', 'JOB_FINISHED_AT_BINDING',
    'JOB_CREATED_AT_FORMAT', 'JOB_UPDATED_AT_FORMAT',
    'LOG_SLOT', 'LOG_ENVELOPE', 'LOG_ERROR', 'LOG_ROWS', 'LOG_ROW_FIELDS',
    'LOG_PERIOD', 'LOG_HTTP_CATEGORY', 'LOG_CONTENT_CATEGORY', 'LOG_SIZE_CATEGORY',
    'LOG_SQLSTATE_CATEGORY', 'LOG_DUPLICATE', 'LOG_EVENTS',
] as const);
export type ProjectionDiagnosticCode = typeof PROJECTION_DIAGNOSTIC_CODES[number];
const ownedErrors = new WeakMap<object, ProjectionDiagnosticCode>();
function fail(code: ProjectionDiagnosticCode): never {
    const error = new Error('READONLY_DIAGNOSTIC_RESPONSE_DENIED');
    ownedErrors.set(error, code);
    throw error;
}
/** Ownership is checked without reading any caught-object property. */
export function getProjectionDiagnosticCode(error: unknown): ProjectionDiagnosticCode | null {
    return error !== null && (typeof error === 'object' || typeof error === 'function') ? ownedErrors.get(error) ?? null : null;
}
function record(value: unknown, allowed: readonly string[], required: readonly string[], code: ProjectionDiagnosticCode): Record<string, unknown> {
    if (!value || typeof value !== 'object' || types.isProxy(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(code);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(value).some(key => typeof key !== 'string' || !allowed.includes(key)) || required.some(key => !Object.hasOwn(descriptors, key)) || Object.values(descriptors).some(field => !Object.hasOwn(field, 'value') || field.get || field.set || !field.enumerable)) fail(code);
    return value as Record<string, unknown>;
}
function instant(value: unknown, code: ProjectionDiagnosticCode): string {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) fail(code);
    const time = Date.parse(value);
    if (!Number.isFinite(time)) fail(code);
    return new Date(time).toISOString();
}
export type ReadOnlyJobBinding = Readonly<{
    jobId: string; serviceId: string; jobPlanId: string; startCommandSHA256: string;
    jobStartedAt: string; jobFinishedAt: string;
}>;
const JOB_FIELDS = ['id', 'serviceId', 'planId', 'startCommand', 'status', 'startedAt', 'finishedAt', 'createdAt', 'updatedAt'];
const REQUIRED_JOB_FIELDS = ['id', 'serviceId', 'planId', 'startCommand', 'status', 'startedAt', 'finishedAt'];
function binding(value: ReadOnlyJobBinding): ReadOnlyJobBinding {
    const keys = ['jobId', 'serviceId', 'jobPlanId', 'startCommandSHA256', 'jobStartedAt', 'jobFinishedAt'];
    const expected = record(value, keys, keys, 'EXPECTED_BINDING');
    if (keys.some(key => typeof expected[key] !== 'string') || !/^[a-f0-9]{64}$/.test(expected.startCommandSHA256 as string) || instant(expected.jobStartedAt, 'EXPECTED_BINDING') !== expected.jobStartedAt || instant(expected.jobFinishedAt, 'EXPECTED_BINDING') !== expected.jobFinishedAt) fail('EXPECTED_BINDING');
    return Object.freeze({ ...expected }) as ReadOnlyJobBinding;
}
export function projectReadOnlyJob(raw: unknown, expectedBinding: ReadOnlyJobBinding) {
    const expected = binding(expectedBinding);
    const container = record(raw, ['job', ...JOB_FIELDS], [], 'JOB_CONTAINER');
    let job = container;
    if (Object.hasOwn(container, 'job')) {
        record(container, ['job'], ['job'], 'JOB_ENVELOPE');
        job = record(container.job, JOB_FIELDS, REQUIRED_JOB_FIELDS, 'JOB_FIELDS');
    } else job = record(job, JOB_FIELDS, REQUIRED_JOB_FIELDS, 'JOB_FIELDS');
    if (job.id !== expected.jobId) fail('JOB_ID');
    if (job.serviceId !== expected.serviceId) fail('JOB_SERVICE');
    if (job.planId !== expected.jobPlanId) fail('JOB_PLAN');
    if (job.status !== 'failed') fail('JOB_STATUS');
    if (typeof job.startCommand !== 'string') fail('JOB_START_COMMAND_TYPE');
    if (createHash('sha256').update(job.startCommand, 'utf8').digest('hex') !== expected.startCommandSHA256) fail('JOB_START_COMMAND_BINDING');
    if (instant(job.startedAt, 'JOB_STARTED_AT_FORMAT') !== expected.jobStartedAt) fail('JOB_STARTED_AT_BINDING');
    if (instant(job.finishedAt, 'JOB_FINISHED_AT_FORMAT') !== expected.jobFinishedAt) fail('JOB_FINISHED_AT_BINDING');
    if (Object.hasOwn(job, 'createdAt')) instant(job.createdAt, 'JOB_CREATED_AT_FORMAT');
    if (Object.hasOwn(job, 'updatedAt')) instant(job.updatedAt, 'JOB_UPDATED_AT_FORMAT');
    return Object.freeze({ id: expected.jobId, serviceId: expected.serviceId, planId: expected.jobPlanId, status: 'failed' as const, startCommandSHA256: expected.startCommandSHA256, startedAt: expected.jobStartedAt, finishedAt: expected.jobFinishedAt });
}

const PERIOD = new Set(['A_CONTROL_WINDOW', 'B_JOB_WINDOW', 'CLOCK_MARGIN_UNATTRIBUTED']);
const HTTP = new Set(['HTTP_200', 'HTTP_400', 'HTTP_401', 'HTTP_403', 'HTTP_404', 'HTTP_408', 'HTTP_413', 'HTTP_422', 'HTTP_429', 'HTTP_500', 'HTTP_502', 'HTTP_503', 'HTTP_504', 'HTTP_520', 'HTTP_522', 'HTTP_524', 'STATUS_MISSING', 'STATUS_OTHER_OR_MALFORMED']);
const CONTENT = new Set(['CONTENT_TYPE_MISSING', 'JSON_DECLARED', 'CONTENT_TYPE_OTHER']);
const SIZE = new Set(['SIZE_MISSING_OR_MALFORMED', 'DECLARED_ABOVE_48M', 'DECLARED_AT_MOST_48M']);
const SQLSTATE = new Set(['QUERY_CANCELED_57014', 'INSUFFICIENT_PRIVILEGE_42501', 'UNDEFINED_TABLE_42P01', 'UNDEFINED_FUNCTION_42883', 'UNDEFINED_COLUMN_42703', 'INVALID_PARAMETER_22023', 'RAISE_EXCEPTION_P0001', 'OUT_OF_MEMORY_53200', 'PROGRAM_LIMIT_54000', 'DISK_FULL_53100', 'CONNECTION_LIMIT_53300', 'SQLSTATE_OTHER_OR_MISSING']);
function rows(value: unknown): unknown[] {
    if (types.isProxy(value) || !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > 20) fail('LOG_ROWS');
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(value).length !== value.length + 1) fail('LOG_ROWS');
    for (let i = 0; i < value.length; i++) if (!descriptors[i] || !Object.hasOwn(descriptors[i], 'value') || !descriptors[i].enumerable) fail('LOG_ROWS');
    return value;
}
function events(value: unknown): number {
    if (typeof value === 'number') {
        if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) fail('LOG_EVENTS');
        return value;
    }
    if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value) || value.length > 16) fail('LOG_EVENTS');
    const n = BigInt(value);
    if (n > BigInt(Number.MAX_SAFE_INTEGER)) fail('LOG_EVENTS');
    return Number(n);
}
export function projectReadOnlyLogs(slot: unknown, raw: unknown) {
    if (slot !== 'historical-gateway-read' && slot !== 'historical-postgres-read') fail('LOG_SLOT');
    const envelope = record(raw, ['result', 'error'], ['result'], 'LOG_ENVELOPE');
    if (Object.hasOwn(envelope, 'error') && envelope.error !== null && envelope.error !== '') fail('LOG_ERROR');
    const input = rows(envelope.result), projected: Readonly<Record<string, string | number>>[] = [], seen = new Set<string>();
    const gateway = slot === 'historical-gateway-read';
    const keys = gateway ? ['period', 'http_category', 'content_type_category', 'body_size_category', 'events'] : ['period', 'sqlstate_category', 'events'];
    for (const value of input) {
        const row = record(value, keys, keys, 'LOG_ROW_FIELDS');
        if (!PERIOD.has(row.period as string)) fail('LOG_PERIOD');
        if (gateway) {
            if (!HTTP.has(row.http_category as string)) fail('LOG_HTTP_CATEGORY');
            if (!CONTENT.has(row.content_type_category as string)) fail('LOG_CONTENT_CATEGORY');
            if (!SIZE.has(row.body_size_category as string)) fail('LOG_SIZE_CATEGORY');
        } else if (!SQLSTATE.has(row.sqlstate_category as string)) fail('LOG_SQLSTATE_CATEGORY');
        const tuple = JSON.stringify(keys.filter(key => key !== 'events').map(key => row[key]));
        if (seen.has(tuple)) fail('LOG_DUPLICATE');
        seen.add(tuple);
        const out: Record<string, string | number> = {};
        for (const key of keys) out[key] = key === 'events' ? events(row.events) : row[key] as string;
        projected.push(Object.freeze(out));
    }
    return Object.freeze({ rows: Object.freeze(projected), observation: projected.length ? 'NONEMPTY_AGGREGATES' as const : 'EMPTY_INCONCLUSIVE' as const, correlation: 'CORRELATION_UNPROVEN' as const });
}
