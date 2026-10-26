/** Versioned failure-only diagnostics. No request, response, exception text,
 * credential, key fingerprint, dynamic path or caller data enters the wire. */
import { isProxy } from 'node:util/types';

export const DIAGNOSTIC_PREFIX = 'ACA_W2_EVIDENCE_READONLY_DIAGNOSTIC ';
export const GENERIC_HOLD = 'ACA_W2_EVIDENCE_READONLY_HOLD_NO_RETRY';
export const OUTER_STAGES = Object.freeze(['OUTER_INIT', 'MANIFEST_READY', 'CHILD_RETURNED', 'CHILD_EXIT_ACCEPTED', 'RESULT_VALIDATED'] as const);
export const OUTER_FAILURE_CODES = Object.freeze(['MANIFEST_IO_OR_SCOPE_DENIED', 'CHILD_SPAWN_ERROR', 'CHILD_TIMEOUT_OR_SIGNAL', 'CHILD_NONZERO', 'CHILD_STDERR_PRESENT', 'CHILD_OUTPUT_BOUND_OR_FORMAT', 'RESULT_SCHEMA_DENIED', 'RESULT_CONTEXT_DENIED', 'RESULT_COMMITMENT_DENIED', 'RESULT_COUNTS_DENIED', 'RESULT_TIME_DENIED', 'UNCLASSIFIED_SAFE_HOLD'] as const);
export const INNER_STAGES = Object.freeze(['MANIFEST_VALIDATED', 'STAGING_SCOPE_VALIDATED', 'EVIDENCE_CLIENT_READY', 'CAPTURE_DISPATCH_RESERVED', 'CAPTURE_RESPONSE_VALIDATED', 'COMMITMENT_MATCHED'] as const);
export const INNER_FAILURE_CODES = Object.freeze(['MANIFEST_DENIED', 'STAGING_SCOPE_DENIED', 'EVIDENCE_CLIENT_DENIED', 'CAPTURE_READONLY_UNAVAILABLE', 'COMMITMENT_OR_ROW_COUNT_MISMATCH', 'UNCLASSIFIED_SAFE_HOLD'] as const);
export type OuterStage = typeof OUTER_STAGES[number];
export type OuterFailureCode = typeof OUTER_FAILURE_CODES[number];
export type InnerStage = typeof INNER_STAGES[number];
export type InnerFailureCode = typeof INNER_FAILURE_CODES[number];
export type OuterDiagnostic = Readonly<{ version: 1; layer: 'outer'; stage: OuterStage | null; code: OuterFailureCode }>;
export type InnerDiagnostic = Readonly<{ version: 1; layer: 'inner'; stage: InnerStage | null; code: InnerFailureCode }>;
export type EvidenceDiagnostic = OuterDiagnostic | InnerDiagnostic;

function validated(value: unknown): EvidenceDiagnostic {
    if (!value || typeof value !== 'object' || isProxy(value) || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw Error('evidence_diagnostic_denied');
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(value).some(key => typeof key !== 'string') || Object.keys(descriptors).sort().join('|') !== 'code|layer|stage|version' || Object.values(descriptors).some(d => !Object.hasOwn(d, 'value') || !d.enumerable || d.get || d.set)) throw Error('evidence_diagnostic_denied');
    const { version, layer, stage, code } = value as Record<string, unknown>;
    if (version !== 1 || !['outer', 'inner'].includes(layer as string)) throw Error('evidence_diagnostic_denied');
    const stages: readonly unknown[] = layer === 'outer' ? OUTER_STAGES : INNER_STAGES;
    const codes: readonly unknown[] = layer === 'outer' ? OUTER_FAILURE_CODES : INNER_FAILURE_CODES;
    if (!(stage === null || stages.includes(stage)) || !codes.includes(code)) throw Error('evidence_diagnostic_denied');
    return Object.freeze({ version: 1, layer, stage, code }) as EvidenceDiagnostic;
}
export function outerDiagnostic(stage: OuterStage | null, code: OuterFailureCode): OuterDiagnostic {
    return validated({ version: 1, layer: 'outer', stage, code }) as OuterDiagnostic;
}
export function innerDiagnostic(stage: InnerStage | null, code: InnerFailureCode): InnerDiagnostic {
    return validated({ version: 1, layer: 'inner', stage, code }) as InnerDiagnostic;
}
export function formatEvidenceDiagnostic(record: EvidenceDiagnostic): string {
    const line = DIAGNOSTIC_PREFIX + JSON.stringify(validated(record));
    if (Buffer.byteLength(line) > 512) throw Error('evidence_diagnostic_denied');
    return line;
}
export function parseEvidenceDiagnosticLine(line: unknown, expectedLayer?: 'outer' | 'inner'): EvidenceDiagnostic | undefined {
    if (typeof line !== 'string' || Buffer.byteLength(line) > 512 || /[\r\n]/.test(line) || !line.startsWith(DIAGNOSTIC_PREFIX) || expectedLayer !== undefined && expectedLayer !== 'outer' && expectedLayer !== 'inner') return;
    try {
        const record = validated(JSON.parse(line.slice(DIAGNOSTIC_PREFIX.length)));
        // Accept only the canonical encoder bytes. Duplicate JSON keys and
        // alternate encodings cannot carry a second unchecked representation.
        if (expectedLayer !== undefined && record.layer !== expectedLayer || formatEvidenceDiagnostic(record) !== line) return;
        return record;
    } catch { return; }
}
const innerErrors = new WeakMap<object, InnerDiagnostic>();
const FIXED_MESSAGES: Readonly<Record<InnerFailureCode, string>> = Object.freeze({
    MANIFEST_DENIED: 'staging_evidence_manifest_denied',
    STAGING_SCOPE_DENIED: 'staging_evidence_scope_denied',
    EVIDENCE_CLIENT_DENIED: 'staging_evidence_readonly_unavailable_STOP',
    CAPTURE_READONLY_UNAVAILABLE: 'staging_evidence_readonly_unavailable_STOP',
    COMMITMENT_OR_ROW_COUNT_MISMATCH: 'staging_evidence_cross_runtime_mismatch_STOP',
    UNCLASSIFIED_SAFE_HOLD: 'staging_evidence_readonly_unavailable_STOP',
});
export class SafeInnerDiagnosticError extends Error {
    constructor(stage: InnerStage | null, code: InnerFailureCode) {
        const record = innerDiagnostic(stage, code);
        super(FIXED_MESSAGES[record.code]);
        this.name = 'SafeInnerDiagnosticError';
        innerErrors.set(this, record);
    }
}
export function getSafeInnerDiagnostic(error: unknown): InnerDiagnostic | undefined {
    return error !== null && typeof error === 'object' ? innerErrors.get(error) : undefined;
}
