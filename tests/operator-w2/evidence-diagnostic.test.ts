import { describe, it, expect } from 'vitest';
import { OUTER_STAGES, OUTER_FAILURE_CODES, INNER_STAGES, INNER_FAILURE_CODES, DIAGNOSTIC_PREFIX, outerDiagnostic, innerDiagnostic, formatEvidenceDiagnostic, parseEvidenceDiagnosticLine, SafeInnerDiagnosticError, getSafeInnerDiagnostic } from '../../scripts/operator-w2/evidence-diagnostic';

describe('finite versioned failure-only evidence diagnostics', () => {
    it.each(OUTER_FAILURE_CODES)('outer code %s never includes dynamic text', code => {
        for (const stage of [null, ...OUTER_STAGES]) {
            const record = outerDiagnostic(stage, code), line = formatEvidenceDiagnostic(record);
            expect(parseEvidenceDiagnosticLine(line, 'outer')).toEqual(record);
            expect(Object.isFrozen(record)).toBe(true);
            expect(Buffer.byteLength(line)).toBeLessThanOrEqual(512);
            expect(parseEvidenceDiagnosticLine(line, 'inner')).toBeUndefined();
        }
    });
    it.each(INNER_FAILURE_CODES)('inner code %s has bounded fixed error provenance', code => {
        for (const stage of [null, ...INNER_STAGES]) {
            const record = innerDiagnostic(stage, code), error = new SafeInnerDiagnosticError(stage, code);
            expect(parseEvidenceDiagnosticLine(formatEvidenceDiagnostic(record), 'inner')).toEqual(record);
            expect(getSafeInnerDiagnostic(error)).toEqual(record);
            expect(getSafeInnerDiagnostic(Object.create(SafeInnerDiagnosticError.prototype))).toBeUndefined();
            expect(getSafeInnerDiagnostic(new Error('SYNTHETIC_SECRET_DO_NOT_EXPORT'))).toBeUndefined();
            expect(error.message).not.toContain('SYNTHETIC_SECRET');
        }
    });
    it('forbids extra fields, dynamic codes/stages, crossed layers, accessors, proxies and symbols', () => {
        const valid = innerDiagnostic('MANIFEST_VALIDATED', 'CAPTURE_READONLY_UNAVAILABLE');
        const invalid = [
            { ...valid, raw: 'SYNTHETIC_SECRET_DO_NOT_EXPORT' }, { ...valid, code: 'SYNTHETIC_SECRET' },
            { ...valid, stage: 'OUTER_INIT' }, { ...valid, version: 2 }, { ...valid, layer: 'SYNTHETIC_SECRET' },
            Object.assign(Object.create({}), valid), new Proxy(valid, {}), { ...valid, [Symbol('secret')]: 1 },
        ];
        for (const v of invalid) expect(() => formatEvidenceDiagnostic(v as typeof valid)).toThrow('evidence_diagnostic_denied');
        let called = false;
        expect(() => formatEvidenceDiagnostic({ ...valid, get code() { called = true; return 'MANIFEST_DENIED' as const; } })).toThrow('evidence_diagnostic_denied');
        expect(called).toBe(false);
    });
    it('parser accepts exact canonical lines only, never arbitrary stderr/error values', () => {
        const line = formatEvidenceDiagnostic(innerDiagnostic(null, 'MANIFEST_DENIED'));
        const rejected = [undefined, null, new Error('SYNTHETIC_SECRET'), 'SYNTHETIC_SECRET', line + '\n', line + ' ', line.replace('"version":1', '"version":1,"version":1'), DIAGNOSTIC_PREFIX + '{"version":1,"layer":"inner","stage":null,"code":"MANIFEST_DENIED","raw":"SYNTHETIC_SECRET"}', DIAGNOSTIC_PREFIX + '{', 'x'.repeat(513)];
        for (const v of rejected) expect(parseEvidenceDiagnosticLine(v)).toBeUndefined();
        expect(parseEvidenceDiagnosticLine(line)).toEqual(innerDiagnostic(null, 'MANIFEST_DENIED'));
    });
    it('no failure output depends on error object properties', () => {
        let accesses = 0;
        const hostile = { get message() { accesses++; return 'SECRET'; }, get diagnostic() { accesses++; return innerDiagnostic(null, 'MANIFEST_DENIED'); } };
        expect(getSafeInnerDiagnostic(hostile)).toBeUndefined();
        expect(accesses).toBe(0);
    });
});
