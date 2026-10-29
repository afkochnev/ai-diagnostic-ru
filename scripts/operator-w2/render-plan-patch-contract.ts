/** Inert local contract and credential gate. This module has no transport,
 * journal, default credential source or mutation execution path. */
import { createHash } from 'node:crypto';
import { types } from 'node:util';

export const RENDER_PLAN_PATCH_METHOD = 'PATCH' as const;
export const RENDER_PLAN_PATCH_URL = 'https://api.render.com/v1/services/srv-daiqfnrm8hqs73dtaf1g' as const;
export const RENDER_PLAN_PATCH_CONTENT_TYPE = 'application/json' as const;
export const RENDER_PLAN_PATCH_BODY = '{"serviceDetails":{"plan":"0.5c-512mb"}}' as const;
export const RENDER_PLAN_PATCH_BODY_SHA256 = '4c9c77d5008f1f6ba4a135abd54bed05677e5198cced5d6f389b82cd0bdcde9e' as const;

export type PreparedRenderPlanPatch = Readonly<{
    method: typeof RENDER_PLAN_PATCH_METHOD;
    url: typeof RENDER_PLAN_PATCH_URL;
    contentType: typeof RENDER_PLAN_PATCH_CONTENT_TYPE;
    body: typeof RENDER_PLAN_PATCH_BODY;
    bodySHA256: typeof RENDER_PLAN_PATCH_BODY_SHA256;
}>;
type AdapterOptions = Readonly<{
    checkPreconditions(): void;
    credentialReader(): string;
}>;
const preparedRequests = new WeakSet<object>();
const HEX = /^[a-f0-9]{64}$/;
function need(value: unknown, code: string): asserts value {
    if (!value) throw Error('RENDER_PLAN_PATCH_' + code);
}
/** Inspect descriptors before reading values. Accessors, symbols, inherited
 * fields, null/custom prototypes and non-enumerable fields are not this shape. */
function singleField(value: unknown, name: string): unknown {
    need(value !== null && typeof value === 'object' && !types.isProxy(value) && Object.getPrototypeOf(value) === Object.prototype, 'PLAIN_OBJECT');
    const keys = Reflect.ownKeys(value);
    need(keys.length === 1 && keys[0] === name, 'EXACT_FIELDS');
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    need(descriptor && Object.hasOwn(descriptor, 'value') && descriptor.enumerable === true && !descriptor.get && !descriptor.set, 'DATA_FIELD');
    return descriptor.value;
}
function exactBody(body: unknown, expectedBodySHA256: unknown) {
    need(singleField(singleField(body, 'serviceDetails'), 'plan') === '0.5c-512mb', 'PLAN');
    need(typeof expectedBodySHA256 === 'string' && HEX.test(expectedBodySHA256) && expectedBodySHA256 === RENDER_PLAN_PATCH_BODY_SHA256, 'BODY_SHA256');
    need(createHash('sha256').update(RENDER_PLAN_PATCH_BODY, 'utf8').digest('hex') === expectedBodySHA256, 'BODY_BYTES');
}
function checkSynchronous(checkPreconditions: () => void) {
    need(typeof checkPreconditions === 'function' && !types.isProxy(checkPreconditions), 'PRECONDITIONS');
    try { need(checkPreconditions() === undefined, 'PRECONDITIONS_SYNC'); }
    catch { throw Error('RENDER_PLAN_PATCH_PRECONDITIONS_HOLD'); }
}
/** Validates only local data and an explicit synchronous precondition callback.
 * Canonical bytes are a fixed literal rather than serializing caller objects. */
export function prepareRenderPlanPatch(body: unknown, expectedBodySHA256: string, checkPreconditions: () => void): PreparedRenderPlanPatch {
    exactBody(body, expectedBodySHA256);
    checkSynchronous(checkPreconditions);
    const prepared = Object.freeze({
        method: RENDER_PLAN_PATCH_METHOD, url: RENDER_PLAN_PATCH_URL,
        contentType: RENDER_PLAN_PATCH_CONTENT_TYPE, body: RENDER_PLAN_PATCH_BODY,
        bodySHA256: RENDER_PLAN_PATCH_BODY_SHA256,
    });
    preparedRequests.add(prepared);
    return prepared;
}
function ownFunction(options: object, name: keyof AdapterOptions) {
    const descriptor = Object.getOwnPropertyDescriptor(options, name);
    need(descriptor && Object.hasOwn(descriptor, 'value') && descriptor.enumerable === true && typeof descriptor.value === 'function' && !types.isProxy(descriptor.value) && !descriptor.get && !descriptor.set, 'OWN_DATA_METHOD');
    return descriptor.value as AdapterOptions[typeof name];
}
function exactOptions(options: unknown): asserts options is AdapterOptions {
    need(options !== null && typeof options === 'object' && !types.isProxy(options) && Object.getPrototypeOf(options) === Object.prototype, 'OPTIONS');
    const keys = Reflect.ownKeys(options);
    need(keys.length === 2 && keys.every(key => typeof key === 'string') && keys.sort().join('|') === 'checkPreconditions|credentialReader', 'OPTIONS');
}
/** A future reviewed caller may explicitly consume a transient credential only
 * after exact body/hash and synchronous preconditions pass. The consumer must
 * return void; this gate never returns credentials or builds Auth headers. */
export function createRenderPlanPatchAdapter(options: AdapterOptions) {
    exactOptions(options);
    const checkPreconditions = ownFunction(options, 'checkPreconditions') as () => void;
    const credentialReader = ownFunction(options, 'credentialReader') as () => string;
    function unchanged() {
        exactOptions(options);
        need(ownFunction(options, 'checkPreconditions') === checkPreconditions && ownFunction(options, 'credentialReader') === credentialReader, 'METHOD_CHANGED');
    }
    function prepare(body: unknown, expectedBodySHA256: string) {
        unchanged();
        const prepared = prepareRenderPlanPatch(body, expectedBodySHA256, () => { unchanged(); checkSynchronous(checkPreconditions); unchanged(); });
        unchanged();
        return prepared;
    }
    function withValidatedRequest(body: unknown, expectedBodySHA256: string, consume: (prepared: PreparedRenderPlanPatch, credential: string) => void) {
        need(typeof consume === 'function' && !types.isProxy(consume), 'CONSUMER');
        const prepared = prepare(body, expectedBodySHA256);
        need(preparedRequests.has(prepared) && Object.isFrozen(prepared), 'PREPARED_PROOF');
        unchanged();
        let credential = '';
        try {
            credential = credentialReader();
            need(typeof credential === 'string' && /^[A-Za-z0-9._-]{20,4096}$/.test(credential), 'CREDENTIAL');
            unchanged();
            need(consume(prepared, credential) === undefined, 'CONSUMER_SYNC');
            unchanged();
            return prepared;
        } catch { throw Error('RENDER_PLAN_PATCH_CREDENTIAL_GATE_HOLD'); }
        finally { credential = ''; }
    }
    return Object.freeze({ prepare, withValidatedRequest });
}
