import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PROJECTION_DIAGNOSTIC_CODES, getProjectionDiagnosticCode, projectReadOnlyJob, projectReadOnlyLogs, type ProjectionDiagnosticCode } from '../../scripts/operator-w2/read-only-diagnostic-projection';

const marker = 'SYNTHETIC_CREDENTIAL_MAC_RAW_MARKER_DO_NOT_EXPORT';
const command = 'node synthetic-offline-command.mjs';
const expected = Object.freeze({ jobId: 'job-test', serviceId: 'srv-test', jobPlanId: 'plan-test', startCommandSHA256: createHash('sha256').update(command).digest('hex'), jobStartedAt: '2026-10-27T09:59:26.000Z', jobFinishedAt: '2026-10-27T10:00:51.000Z' });
const job = () => ({ id: expected.jobId, serviceId: expected.serviceId, planId: expected.jobPlanId, startCommand: command, status: 'failed', startedAt: '2026-10-27T09:59:26Z', finishedAt: '2026-10-27T10:00:51Z' });
const gatewayRow = () => ({ period: 'B_JOB_WINDOW', http_category: 'HTTP_200', content_type_category: 'JSON_DECLARED', body_size_category: 'DECLARED_AT_MOST_48M', events: '2' });
const pgRow = () => ({ period: 'B_JOB_WINDOW', sqlstate_category: 'QUERY_CANCELED_57014', events: 3 });
function rejected(fn: () => unknown, code: ProjectionDiagnosticCode) {
    let caught: unknown;
    try { fn(); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(Error);
    expect(getProjectionDiagnosticCode(caught)).toBe(code);
    expect(String(caught)).toBe('Error: READONLY_DIAGNOSTIC_RESPONSE_DENIED');
    expect(String(caught)).not.toContain(marker);
    expect(JSON.stringify(caught)).not.toContain(marker);
    return caught;
}
describe('pure finite read-only diagnostic projections', () => {
    it('accepts exact raw and wrapped job, only returns pinned projection', () => {
        const raw = { ...job(), createdAt: '2026-10-27T09:59:25.658Z', updatedAt: '2026-10-27T10:00:51Z' };
        for (const value of [raw, { job: raw }, Object.assign(Object.create(null), raw)]) {
            const result = projectReadOnlyJob(value, expected);
            expect(result).toEqual({ id: expected.jobId, serviceId: expected.serviceId, planId: expected.jobPlanId, status: 'failed', startCommandSHA256: expected.startCommandSHA256, startedAt: expected.jobStartedAt, finishedAt: expected.jobFinishedAt });
            expect(Object.isFrozen(result)).toBe(true);
            expect(result).not.toHaveProperty('startCommand');
        }
    });
    it.each([
        [null, 'JOB_CONTAINER'], [{ ...job(), raw: marker }, 'JOB_CONTAINER'],
        [{ job: job(), id: marker }, 'JOB_ENVELOPE'], [{ job: { ...job(), raw: marker } }, 'JOB_FIELDS'],
        [{ ...job(), id: marker }, 'JOB_ID'], [{ ...job(), serviceId: marker }, 'JOB_SERVICE'],
        [{ ...job(), planId: marker }, 'JOB_PLAN'], [{ ...job(), status: marker }, 'JOB_STATUS'],
        [{ ...job(), startCommand: null }, 'JOB_START_COMMAND_TYPE'], [{ ...job(), startCommand: marker }, 'JOB_START_COMMAND_BINDING'],
        [{ ...job(), startedAt: marker }, 'JOB_STARTED_AT_FORMAT'], [{ ...job(), startedAt: '2026-10-27T09:59:27Z' }, 'JOB_STARTED_AT_BINDING'],
        [{ ...job(), finishedAt: marker }, 'JOB_FINISHED_AT_FORMAT'], [{ ...job(), finishedAt: '2026-10-27T10:00:52Z' }, 'JOB_FINISHED_AT_BINDING'],
        [{ ...job(), createdAt: marker }, 'JOB_CREATED_AT_FORMAT'], [{ ...job(), updatedAt: marker }, 'JOB_UPDATED_AT_FORMAT'],
    ] as const)('job rejection exposes only code %s', (raw, code) => { rejected(() => projectReadOnlyJob(raw, expected), code); });
    it('preserves strict own-data shape and does not invoke accessors/proxies', () => {
        let reads = 0;
        const get = { ...job(), get status() { reads++; return marker; } };
        const proxied = new Proxy(job(), { get() { reads++; throw Error(marker); }, ownKeys() { reads++; throw Error(marker); } });
        rejected(() => projectReadOnlyJob(get, expected), 'JOB_CONTAINER');
        rejected(() => projectReadOnlyJob(proxied, expected), 'JOB_CONTAINER');
        rejected(() => projectReadOnlyJob(Object.assign(Object.create({ inherited: true }), job()), expected), 'JOB_CONTAINER');
        rejected(() => projectReadOnlyJob({ ...job(), [Symbol(marker)]: 1 }, expected), 'JOB_CONTAINER');
        expect(reads).toBe(0);
    });
    it('validates expected binding before any raw access', () => {
        let reads = 0;
        const raw = new Proxy({}, { get() { reads++; throw Error(marker); } });
        for (const invalid of [{ ...expected, extra: marker }, { ...expected, startCommandSHA256: marker }, { ...expected, jobStartedAt: '2026-10-27T09:59:26Z' }, new Proxy(expected, {})]) rejected(() => projectReadOnlyJob(raw, invalid), 'EXPECTED_BINDING');
        const accessor = { ...expected, get jobId() { reads++; return marker; } };
        rejected(() => projectReadOnlyJob(raw, accessor), 'EXPECTED_BINDING');
        expect(reads).toBe(0);
    });
    it('only accepts helper-owned errors, without reading forged values', () => {
        let reads = 0;
        const own = rejected(() => projectReadOnlyJob(null, expected), 'JOB_CONTAINER');
        for (const foreign of [null, undefined, 'JOB_CONTAINER', new Error(marker), Object.create(Error.prototype), { code: 'JOB_CONTAINER' }, new Proxy(own as Error, {}), { get code() { reads++; throw Error(marker); }, get message() { reads++; throw Error(marker); } }]) expect(getProjectionDiagnosticCode(foreign)).toBeNull();
        expect(reads).toBe(0);
        expect(Object.isFrozen(PROJECTION_DIAGNOSTIC_CODES)).toBe(true);
    });
    it('accepts exact log envelopes and leaves empty results inconclusive', () => {
        const gateway = projectReadOnlyLogs('historical-gateway-read', { result: [gatewayRow()], error: null });
        expect(gateway.rows[0].events).toBe(2);
        expect(gateway.observation).toBe('NONEMPTY_AGGREGATES');
        const postgres = projectReadOnlyLogs('historical-postgres-read', { result: [pgRow()], error: '' });
        expect(postgres.rows[0].events).toBe(3);
        for (const value of [gateway, postgres]) { expect(value.correlation).toBe('CORRELATION_UNPROVEN'); expect(Object.isFrozen(value)).toBe(true); expect(Object.isFrozen(value.rows)).toBe(true); expect(Object.isFrozen(value.rows[0])).toBe(true); }
        expect(projectReadOnlyLogs('historical-postgres-read', { result: [] })).toEqual({ rows: [], observation: 'EMPTY_INCONCLUSIVE', correlation: 'CORRELATION_UNPROVEN' });
    });
    it.each([
        ['other', { result: [] }, 'LOG_SLOT'], ['historical-gateway-read', { result: [], raw: marker }, 'LOG_ENVELOPE'],
        ['historical-gateway-read', { result: [], error: marker }, 'LOG_ERROR'], ['historical-gateway-read', { result: null }, 'LOG_ROWS'],
        ['historical-gateway-read', { result: Array.from({ length: 21 }, gatewayRow) }, 'LOG_ROWS'],
        ['historical-gateway-read', { result: [{ ...gatewayRow(), raw: marker }] }, 'LOG_ROW_FIELDS'],
        ['historical-gateway-read', { result: [{ ...gatewayRow(), period: marker }] }, 'LOG_PERIOD'],
        ['historical-gateway-read', { result: [{ ...gatewayRow(), http_category: marker }] }, 'LOG_HTTP_CATEGORY'],
        ['historical-gateway-read', { result: [{ ...gatewayRow(), content_type_category: marker }] }, 'LOG_CONTENT_CATEGORY'],
        ['historical-gateway-read', { result: [{ ...gatewayRow(), body_size_category: marker }] }, 'LOG_SIZE_CATEGORY'],
        ['historical-postgres-read', { result: [{ ...pgRow(), sqlstate_category: marker }] }, 'LOG_SQLSTATE_CATEGORY'],
        ['historical-gateway-read', { result: [gatewayRow(), gatewayRow()] }, 'LOG_DUPLICATE'],
    ] as const)('log rejection exposes only code %s', (slot, raw, code) => { rejected(() => projectReadOnlyLogs(slot, raw), code); });
    it.each([-0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '', '01', '-1', '+1', '1.0', '1e1', ' 1', '1 ', '9007199254740992', '99999999999999999', null, {}, true, marker])('denies invalid event count %s', value => {
        rejected(() => projectReadOnlyLogs('historical-gateway-read', { result: [{ ...gatewayRow(), events: value }] }), 'LOG_EVENTS');
    });
    it.each([0, 1, Number.MAX_SAFE_INTEGER, '0', '1', '9007199254740991'])('accepts exact safe count %s', value => {
        expect(projectReadOnlyLogs('historical-gateway-read', { result: [{ ...gatewayRow(), events: value }] }).rows[0].events).toBe(Number(value));
    });
    it('rejects row/array accessors and proxies without invoking them', () => {
        let reads = 0;
        const accessor = { ...gatewayRow(), get events() { reads++; return marker; } };
        rejected(() => projectReadOnlyLogs('historical-gateway-read', { result: [accessor] }), 'LOG_ROW_FIELDS');
        rejected(() => projectReadOnlyLogs('historical-gateway-read', { result: new Proxy([], { get() { reads++; throw Error(marker); } }) }), 'LOG_ROWS');
        const list = [gatewayRow()]; Object.defineProperty(list, '0', { get() { reads++; return gatewayRow(); }, enumerable: true });
        rejected(() => projectReadOnlyLogs('historical-gateway-read', { result: list }), 'LOG_ROWS');
        const sparse = new Array(1);
        rejected(() => projectReadOnlyLogs('historical-gateway-read', { result: sparse }), 'LOG_ROWS');
        expect(reads).toBe(0);
    });
    it('does not echo any unknown provider marker or classify historical error retrospectively', () => {
        for (const raw of [{ message: marker }, { ...job(), startCommand: marker }, { job: job(), headers: { Authorization: marker } }]) {
            let error; try { projectReadOnlyJob(raw, expected); } catch (caught) { error = caught; }
            expect(JSON.stringify({ code: getProjectionDiagnosticCode(error), error })).not.toContain(marker);
        }
        expect(getProjectionDiagnosticCode(new Error('PROJECTION'))).toBeNull();
    });
});
