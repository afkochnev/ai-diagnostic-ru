import { execFileSync } from 'node:child_process';
import { chmodSync, lstatSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { evidenceKeyContext } from '../../src/server/team/evidence-channel-key';
import {
    buildReadonlyEvidenceRunnerSource, READONLY_CHILD_TIMEOUT_MS, READONLY_RESULT_PREFIX,
    runReadonlyEvidenceRunner, type ReadonlyRunnerOptions,
} from '../../scripts/operator-w2/evidence-readonly-runner';
import {
    formatEvidenceDiagnostic, GENERIC_HOLD, innerDiagnostic, parseEvidenceDiagnosticLine,
    type OuterFailureCode, type OuterStage,
} from '../../scripts/operator-w2/evidence-diagnostic';

const ports = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', async importOriginal => ({ ...await importOriginal<typeof import('node:child_process')>(), spawnSync: ports.spawn }));
const roots: string[] = [], sensitive = 'synthetic-secret-url-error-child-value-never-export';
const context = evidenceKeyContext({ domain: 'aca-w2-evidence-key', version: 1, rootRunId: 'e3623f1d-2da0-4dfe-b600-d747f529c5fc', approvedPlanSHA256: 'b'.repeat(64), canonicalAppSHA: 'a'.repeat(40) });
const capturedAt = '2026-10-26T10:00:00Z';
function fixture() {
    const root = mkdtempSync(join(tmpdir(), 'aca-readonly-wrapper-test-')); roots.push(root);
    return {
        manifest: { version: 2, purpose: 'STAGING_STORAGE_CAPTURE_ACCEPTANCE_V2', project: 'vflgxgdwlftlyjslyrmo', rootRunId: context.rootRunId, expectedSHA: context.canonicalAppSHA, approvedPlanSHA256: context.approvedPlanSHA256, expectedCaptureSHA256: 'c'.repeat(64), expectedRowCount: 8337 },
        nativeBinding: { context, captureSHA256: 'c'.repeat(64), rowCount: 8337, AuthRows: 260, capturedAt },
        directory: join(root, 'manifest'), childArgs: ['synthetic-child.ts'],
    } satisfies ReadonlyRunnerOptions;
}
function result(input = fixture()) {
    return { status: 'STAGING_CROSS_RUNTIME_EVIDENCE_MATCH', context, captureSHA256: input.nativeBinding.captureSHA256, tableCount: 122, rowCount: input.nativeBinding.rowCount, AuthTableCount: 27, AuthRows: input.nativeBinding.AuthRows, ledger: 58, capturedAt, actualCapabilityPOSTs: 0, actualCapturePOSTs: 1, retries: 0, W2Writes: 0, AuthIssuanceVerificationEmailAIYooKassaPDF: 0 };
}
function child(stdout = '', stderr = '') { return { status: 0, signal: null, error: undefined, stdout, stderr }; }
function lines(value: { mock: { calls: unknown[][] } }) { return value.mock.calls.map(args => args[0]); }
function assertHold(stderr: unknown[], code: OuterFailureCode, stage: OuterStage) {
    expect(stderr.at(-1)).toBe(GENERIC_HOLD);
    expect(parseEvidenceDiagnosticLine(stderr.at(-2), 'outer')).toEqual({ version: 1, layer: 'outer', code, stage });
    expect(JSON.stringify(stderr)).not.toContain(sensitive);
    expect(process.exitCode).toBe(1);
}
beforeEach(() => { ports.spawn.mockReset(); ports.spawn.mockReturnValue(child()); });
afterEach(() => { vi.restoreAllMocks(); process.exitCode = undefined; for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('finite staging evidence outer wrapper', () => {
    it('imports and builds compact source without child, credential, journal or network effects', () => {
        const fetch = vi.spyOn(globalThis, 'fetch'), input = fixture();
        const source = buildReadonlyEvidenceRunnerSource(input);
        expect(source).toContain("require('./scripts/operator-w2/evidence-readonly-runner.ts')");
        expect(Buffer.byteLength(source)).toBeLessThan(4096);
        expect(ports.spawn).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
        expect(() => lstatSync(input.directory)).toThrow();
        expect(source).not.toMatch(/service_role|SUPABASE_SERVICE_ROLE_KEY|AUTH_FLOW_SECRET|journal|fetch\(/);
    });
    it('writes one exact durable exclusive manifest and accepts one unchanged result line', () => {
        const input = fixture(), stdout = READONLY_RESULT_PREFIX + JSON.stringify(result(input)) + '\n';
        ports.spawn.mockReturnValue(child(stdout)); const log = vi.spyOn(console, 'log').mockImplementation(() => {}), error = vi.spyOn(console, 'error').mockImplementation(() => {});
        runReadonlyEvidenceRunner(input);
        const path = input.directory + '/storage-inventory-v2.json', stat = lstatSync(path);
        expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(input.manifest);
        expect(stat.mode & 0o777).toBe(0o600); expect(stat.uid).toBe(process.getuid?.()); expect(stat.nlink).toBe(1);
        expect(lstatSync(input.directory).mode & 0o777).toBe(0o700);
        expect(ports.spawn).toHaveBeenCalledExactlyOnceWith(process.execPath, [...input.childArgs, path], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: READONLY_CHILD_TIMEOUT_MS, killSignal: 'SIGKILL', maxBuffer: 8192 });
        expect(lines(log)).toEqual([stdout.trim()]); expect(error).not.toHaveBeenCalled(); expect(process.exitCode).toBeUndefined();
    });
    it.each(['existing', 'mode', 'symlink'])('fails closed at manifest boundary (%s) and never starts a child', kind => {
        const input = fixture();
        if (kind === 'existing') { writeFileSync(join(roots.at(-1)!, 'exists'), 'x'); input.directory = roots.at(-1)!; writeFileSync(join(input.directory, 'storage-inventory-v2.json'), sensitive, { mode: 0o600 }); }
        if (kind === 'mode') { input.directory = roots.at(-1)!; chmodSync(input.directory, 0o755); }
        if (kind === 'symlink') symlinkSync(roots.at(-1)!, input.directory);
        const error = vi.spyOn(console, 'error').mockImplementation(() => {}); runReadonlyEvidenceRunner(input);
        assertHold(lines(error), 'MANIFEST_IO_OR_SCOPE_DENIED', 'OUTER_INIT'); expect(ports.spawn).not.toHaveBeenCalled();
    });
    it('cannot overwrite a manifest by rerunning the same local invocation', () => {
        const input = fixture(), log = vi.spyOn(console, 'log').mockImplementation(() => {}), error = vi.spyOn(console, 'error').mockImplementation(() => {});
        ports.spawn.mockReturnValue(child(READONLY_RESULT_PREFIX + JSON.stringify(result(input)))); runReadonlyEvidenceRunner(input);
        const before = readFileSync(input.directory + '/storage-inventory-v2.json'); runReadonlyEvidenceRunner(input);
        expect(readFileSync(input.directory + '/storage-inventory-v2.json')).toEqual(before); expect(ports.spawn).toHaveBeenCalledTimes(1); expect(log).toHaveBeenCalledTimes(1);
        assertHold(lines(error), 'MANIFEST_IO_OR_SCOPE_DENIED', 'OUTER_INIT');
    });
    it.each([
        ['throw', undefined, 'CHILD_SPAWN_ERROR', 'MANIFEST_READY'],
        ['spawn error', { error: Object.assign(Error(sensitive), { code: 'ENOENT' }) }, 'CHILD_SPAWN_ERROR', 'CHILD_RETURNED'],
        ['timeout', { error: Object.assign(Error(sensitive), { code: 'ETIMEDOUT' }) }, 'CHILD_TIMEOUT_OR_SIGNAL', 'CHILD_RETURNED'],
        ['signal', { signal: 'SIGKILL' }, 'CHILD_TIMEOUT_OR_SIGNAL', 'CHILD_RETURNED'],
        ['nonzero', { status: 1, stderr: sensitive }, 'CHILD_NONZERO', 'CHILD_RETURNED'],
        ['stderr', { stderr: sensitive }, 'CHILD_STDERR_PRESENT', 'CHILD_EXIT_ACCEPTED'],
        ['buffer stdout', { stdout: Buffer.from(sensitive) }, 'CHILD_OUTPUT_BOUND_OR_FORMAT', 'CHILD_EXIT_ACCEPTED'],
        ['invalid JSON', { stdout: READONLY_RESULT_PREFIX + sensitive }, 'CHILD_OUTPUT_BOUND_OR_FORMAT', 'CHILD_EXIT_ACCEPTED'],
        ['too many lines', { stdout: 'x\ny\n' }, 'CHILD_OUTPUT_BOUND_OR_FORMAT', 'CHILD_EXIT_ACCEPTED'],
        ['output bound', { stdout: READONLY_RESULT_PREFIX + 'x'.repeat(4096) }, 'CHILD_OUTPUT_BOUND_OR_FORMAT', 'CHILD_EXIT_ACCEPTED'],
        ['wrong prefix', { stdout: sensitive }, 'CHILD_OUTPUT_BOUND_OR_FORMAT', 'CHILD_EXIT_ACCEPTED'],
    ] as const)('classifies %s without exporting child/error material or retrying', (_name, override, code, stage) => {
        const input = fixture(), error = vi.spyOn(console, 'error').mockImplementation(() => {}), log = vi.spyOn(console, 'log').mockImplementation(() => {});
        if (override === undefined) ports.spawn.mockImplementation(() => { throw Error(sensitive); });
        else ports.spawn.mockReturnValue({ ...child(READONLY_RESULT_PREFIX + JSON.stringify(result(input))), ...override });
        runReadonlyEvidenceRunner(input); assertHold(lines(error), code, stage); expect(log).not.toHaveBeenCalled(); expect(ports.spawn).toHaveBeenCalledTimes(1);
    });
    it.each([
        ['schema', (v: Record<string, unknown>) => { v.extra = sensitive; }, 'RESULT_SCHEMA_DENIED'],
        ['status', (v: Record<string, unknown>) => { v.status = sensitive; }, 'RESULT_SCHEMA_DENIED'],
        ['context', (v: Record<string, unknown>) => { v.context = { ...context, approvedPlanSHA256: '0'.repeat(64) }; }, 'RESULT_CONTEXT_DENIED'],
        ['commitment', (v: Record<string, unknown>) => { v.captureSHA256 = sensitive; }, 'RESULT_COMMITMENT_DENIED'],
        ['counts', (v: Record<string, unknown>) => { v.rowCount = 0; }, 'RESULT_COUNTS_DENIED'],
        ['unsafe effect', (v: Record<string, unknown>) => { v.retries = 1; }, 'RESULT_COUNTS_DENIED'],
        ['time syntax', (v: Record<string, unknown>) => { v.capturedAt = sensitive; }, 'RESULT_TIME_DENIED'],
        ['time ordering', (v: Record<string, unknown>) => { v.capturedAt = '2026-10-26T09:59:59Z'; }, 'RESULT_TIME_DENIED'],
    ] as const)('classifies result %s mismatch at the last completed boundary', (_name, mutate, code) => {
        const input = fixture(), value = result(input); mutate(value);
        ports.spawn.mockReturnValue(child(READONLY_RESULT_PREFIX + JSON.stringify(value))); const error = vi.spyOn(console, 'error').mockImplementation(() => {}), log = vi.spyOn(console, 'log').mockImplementation(() => {});
        runReadonlyEvidenceRunner(input); assertHold(lines(error), code, 'CHILD_EXIT_ACCEPTED'); expect(log).not.toHaveBeenCalled(); expect(ports.spawn).toHaveBeenCalledTimes(1);
    });
    it('exports only an independently parsed complete canonical inner diagnostic', () => {
        const input = fixture(), line = formatEvidenceDiagnostic(innerDiagnostic('CAPTURE_DISPATCH_RESERVED', 'CAPTURE_READONLY_UNAVAILABLE'));
        ports.spawn.mockReturnValue({ ...child('', line + '\n' + GENERIC_HOLD + '\n'), status: 1 }); const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        runReadonlyEvidenceRunner(input); expect(lines(error)[0]).toBe(line); expect(lines(error)).toHaveLength(3); assertHold(lines(error), 'CHILD_NONZERO', 'CHILD_RETURNED');
    });
    it.each([
        sensitive,
        formatEvidenceDiagnostic(innerDiagnostic(null, 'MANIFEST_DENIED')) + '\n',
        formatEvidenceDiagnostic(innerDiagnostic(null, 'MANIFEST_DENIED')) + '\n' + GENERIC_HOLD + '\n' + sensitive,
        'ACA_W2_EVIDENCE_READONLY_DIAGNOSTIC {"version":1,"layer":"inner","stage":null,"code":"MANIFEST_DENIED","raw":"' + sensitive + '"}\n' + GENERIC_HOLD,
    ])('does not forward incomplete, arbitrary or extended stderr', stderr => {
        const input = fixture(), error = vi.spyOn(console, 'error').mockImplementation(() => {});
        ports.spawn.mockReturnValue({ ...child('', stderr), status: 1 }); runReadonlyEvidenceRunner(input);
        expect(lines(error)).toHaveLength(2); assertHold(lines(error), 'CHILD_NONZERO', 'CHILD_RETURNED');
    });
    it('does not promote a valid inner diagnostic to child success', () => {
        const input = fixture(), line = formatEvidenceDiagnostic(innerDiagnostic(null, 'MANIFEST_DENIED'));
        ports.spawn.mockReturnValue(child(READONLY_RESULT_PREFIX + JSON.stringify(result(input)), line + '\n' + GENERIC_HOLD)); const error = vi.spyOn(console, 'error').mockImplementation(() => {}), log = vi.spyOn(console, 'log').mockImplementation(() => {});
        runReadonlyEvidenceRunner(input); assertHold(lines(error), 'CHILD_STDERR_PRESENT', 'CHILD_EXIT_ACCEPTED'); expect(log).not.toHaveBeenCalled();
    });
    it('keeps unexpected outer failures finite at the last completed stage', () => {
        const input = fixture(); ports.spawn.mockReturnValue(child(READONLY_RESULT_PREFIX + JSON.stringify(result(input)))); const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'log').mockImplementation(() => { throw Error(sensitive); }); runReadonlyEvidenceRunner(input);
        assertHold(lines(error), 'UNCLASSIFIED_SAFE_HOLD', 'RESULT_VALIDATED');
    });
    it.each([0, 120001, Infinity, 1.5])('denies an invalid watchdog %s locally before filesystem or child execution', timeoutMs => {
        const input = { ...fixture(), timeoutMs }; expect(() => buildReadonlyEvidenceRunnerSource(input)).toThrow('READONLY_RUNNER_SOURCE_DENIED'); expect(ports.spawn).not.toHaveBeenCalled(); expect(() => lstatSync(input.directory)).toThrow();
    });
    it('denies accessors and Proxy options without invoking them', () => {
        const input = fixture(), get = vi.fn(); Object.defineProperty(input, 'directory', { enumerable: true, get }); expect(() => buildReadonlyEvidenceRunnerSource(input)).toThrow(); expect(get).not.toHaveBeenCalled();
        const traps = { get: vi.fn(), ownKeys: vi.fn() }; expect(() => buildReadonlyEvidenceRunnerSource(new Proxy(fixture(), traps))).toThrow(); expect(traps.get).not.toHaveBeenCalled(); expect(traps.ownKeys).not.toHaveBeenCalled();
    });
    it('runs the exact compact tsx loader and actual child locally with no network', () => {
        const input = fixture(), script = join(roots.at(-1)!, 'child.cjs'), expected = READONLY_RESULT_PREFIX + JSON.stringify(result(input));
        writeFileSync(script, 'process.stdout.write(' + JSON.stringify(expected + '\n') + ')', { mode: 0o600 }); input.childArgs = [script];
        const source = buildReadonlyEvidenceRunnerSource(input);
        const actual = execFileSync(process.execPath, ['--import', 'tsx', '-e', source], { cwd: process.cwd(), encoding: 'utf8', timeout: 10000 });
        expect(actual).toBe(expected + '\n');
    });
    it('suppresses loader/import errors with fixed finite diagnostics and generic HOLD', () => {
        const input = fixture(), source = buildReadonlyEvidenceRunnerSource(input);
        try {
            execFileSync(process.execPath, ['--import', join(process.cwd(), 'node_modules/tsx/dist/loader.mjs'), '-e', source], { cwd: roots.at(-1)!, encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] });
            throw Error('expected local missing module');
        } catch (error) {
            const failed = error as { status: number; stdout: string; stderr: string };
            expect(failed.status).toBe(1); expect(failed.stdout).toBe('');
            const output = failed.stderr.trim().split('\n');
            expect(output).toEqual([formatEvidenceDiagnostic({ version: 1, layer: 'outer', stage: 'OUTER_INIT', code: 'UNCLASSIFIED_SAFE_HOLD' }), GENERIC_HOLD]);
            expect(failed.stderr).not.toContain(input.directory);
            expect(failed.stderr).not.toContain('MODULE_NOT_FOUND');
        }
    });
});
