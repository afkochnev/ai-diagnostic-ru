import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    createRenderPlanPatchAdapter, prepareRenderPlanPatch,
    RENDER_PLAN_PATCH_BODY, RENDER_PLAN_PATCH_BODY_SHA256, RENDER_PLAN_PATCH_CONTENT_TYPE,
    RENDER_PLAN_PATCH_METHOD, RENDER_PLAN_PATCH_URL,
} from '../../scripts/operator-w2/render-plan-patch-contract';

const KEY = 'synthetic-render-key-only-for-local-tests';
const directories: string[] = [];
const body = () => ({ serviceDetails: { plan: '0.5c-512mb' } });
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
function fixture() {
    const trace: string[] = [];
    const options = {
        checkPreconditions: vi.fn(() => { trace.push('preconditions'); }),
        credentialReader: vi.fn(() => { trace.push('credentials'); return KEY; }),
    };
    return { options, trace, adapter: createRenderPlanPatchAdapter(options) };
}
afterEach(() => { vi.unstubAllGlobals(); for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); });

describe('exact local Render web-service compute-plan PATCH contract', () => {
    it('pins exact nested bytes independently of an historical journal request hash', () => {
        expect(RENDER_PLAN_PATCH_BODY).toBe('{"serviceDetails":{"plan":"0.5c-512mb"}}');
        expect(hash(RENDER_PLAN_PATCH_BODY)).toBe(RENDER_PLAN_PATCH_BODY_SHA256);
        const preconditions = vi.fn();
        const prepared = prepareRenderPlanPatch(body(), RENDER_PLAN_PATCH_BODY_SHA256, preconditions);
        expect(prepared).toEqual({ method: RENDER_PLAN_PATCH_METHOD, url: RENDER_PLAN_PATCH_URL, contentType: RENDER_PLAN_PATCH_CONTENT_TYPE, body: RENDER_PLAN_PATCH_BODY, bodySHA256: RENDER_PLAN_PATCH_BODY_SHA256 });
        expect(Object.isFrozen(prepared)).toBe(true);
        expect(preconditions).toHaveBeenCalledExactlyOnceWith();
        expect(JSON.stringify(prepared)).not.toContain(KEY);
    });
    it.each([
        ['top-level plan', { plan: '0.5c-512mb' }],
        ['buildPlan', { serviceDetails: { buildPlan: '0.5c-512mb' } }],
        ['extra top-level', { serviceDetails: { plan: '0.5c-512mb' }, name: 'unchanged' }],
        ['extra nested', { serviceDetails: { plan: '0.5c-512mb', numInstances: 1 } }],
        ['wrong plan', { serviceDetails: { plan: 'free' } }],
        ['legacy starter', { serviceDetails: { plan: 'starter' } }],
        ['full service object', { id: 'srv-daiqfnrm8hqs73dtaf1g', type: 'web_service', serviceDetails: { plan: '0.5c-512mb' } }],
        ['null', null], ['array', []], ['stringified JSON', RENDER_PLAN_PATCH_BODY],
        ['null prototype', Object.assign(Object.create(null), body())],
        ['custom prototype', Object.assign(Object.create({ inherited: true }), body())],
        ['nested null prototype', { serviceDetails: Object.assign(Object.create(null), { plan: '0.5c-512mb' }) }],
        ['inherited serviceDetails', Object.create(body())],
        ['inherited plan', { serviceDetails: Object.create({ plan: '0.5c-512mb' }) }],
        ['prototype pollution field', JSON.parse('{"serviceDetails":{"plan":"0.5c-512mb","__proto__":{}}}')],
    ])('denies %s before preconditions, credentials or consumer', (_name, input) => {
        const f = fixture(), consume = vi.fn();
        expect(() => f.adapter.withValidatedRequest(input, RENDER_PLAN_PATCH_BODY_SHA256, consume)).toThrow('RENDER_PLAN_PATCH_');
        expect(f.trace).toEqual([]); expect(consume).not.toHaveBeenCalled();
    });
    it.each(['top', 'nested', 'top-extra', 'nested-extra'])('denies symbols/hidden extras (%s)', location => {
        const input = body(), target = location.startsWith('nested') ? input.serviceDetails : input;
        Object.defineProperty(target, location.endsWith('extra') ? 'extra' : Symbol('extra'), { value: true, enumerable: false });
        const f = fixture(); expect(() => f.adapter.prepare(input, RENDER_PLAN_PATCH_BODY_SHA256)).toThrow(); expect(f.trace).toEqual([]);
    });
    it.each(['serviceDetails', 'plan'])('does not invoke an accessor for %s', name => {
        const getter = vi.fn(() => name === 'plan' ? '0.5c-512mb' : { plan: '0.5c-512mb' }), input = body();
        Object.defineProperty(name === 'plan' ? input.serviceDetails : input, name, { get: getter, enumerable: true });
        const f = fixture(); expect(() => f.adapter.prepare(input, RENDER_PLAN_PATCH_BODY_SHA256)).toThrow('DATA_FIELD');
        expect(getter).not.toHaveBeenCalled(); expect(f.trace).toEqual([]);
    });
    it.each(['serviceDetails', 'plan'])('denies a non-enumerable required %s', name => {
        const input = body(), target = name === 'plan' ? input.serviceDetails : input;
        const value = name === 'plan' ? '0.5c-512mb' : input.serviceDetails;
        Object.defineProperty(target, name, { value, enumerable: false });
        const f = fixture(); expect(() => f.adapter.prepare(input, RENDER_PLAN_PATCH_BODY_SHA256)).toThrow('DATA_FIELD'); expect(f.trace).toEqual([]);
    });
    it.each(['top', 'nested'])('denies a %s body Proxy without invoking reflection traps or reading credentials', location => {
        const f = fixture(), consume = vi.fn(), traps = {
            getPrototypeOf: vi.fn(Reflect.getPrototypeOf), ownKeys: vi.fn(Reflect.ownKeys),
            getOwnPropertyDescriptor: vi.fn(Reflect.getOwnPropertyDescriptor), get: vi.fn(Reflect.get),
        };
        const input = location === 'top' ? new Proxy(body(), traps) : { serviceDetails: new Proxy(body().serviceDetails, traps) };
        expect(() => f.adapter.withValidatedRequest(input, RENDER_PLAN_PATCH_BODY_SHA256, consume)).toThrow('PLAIN_OBJECT');
        for (const trap of Object.values(traps)) expect(trap).not.toHaveBeenCalled();
        expect(f.trace).toEqual([]); expect(consume).not.toHaveBeenCalled();
    });
    it.each(['top', 'nested'])('denies a revoked %s body Proxy with a stable local error', location => {
        const proxy = Proxy.revocable(location === 'top' ? body() : body().serviceDetails, {}); proxy.revoke();
        const input = location === 'top' ? proxy.proxy : { serviceDetails: proxy.proxy }, f = fixture();
        expect(() => f.adapter.withValidatedRequest(input, RENDER_PLAN_PATCH_BODY_SHA256, vi.fn())).toThrow('RENDER_PLAN_PATCH_PLAIN_OBJECT');
        expect(f.trace).toEqual([]);
    });
    it.each(['0'.repeat(64), RENDER_PLAN_PATCH_BODY_SHA256.toUpperCase(), '', hash('{"plan":"0.5c-512mb"}')])('denies a mismatched/noncanonical expected body hash', expected => {
        const f = fixture(), consume = vi.fn();
        expect(() => f.adapter.withValidatedRequest(body(), expected, consume)).toThrow('BODY_SHA256');
        expect(f.trace).toEqual([]); expect(consume).not.toHaveBeenCalled();
    });
    it('copies to fixed immutable bytes instead of retaining caller objects', () => {
        const input = body(), f = fixture(), prepared = f.adapter.prepare(input, RENDER_PLAN_PATCH_BODY_SHA256);
        input.serviceDetails.plan = 'starter';
        expect(prepared.body).toBe(RENDER_PLAN_PATCH_BODY); expect(f.options.credentialReader).not.toHaveBeenCalled();
        expect(() => Object.assign(prepared, { body: '{}' })).toThrow();
    });
    it('constructs and validates without credential reads, network, journal or mutation slots', () => {
        const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
        const f = fixture(); expect(f.trace).toEqual([]);
        f.adapter.prepare(body(), RENDER_PLAN_PATCH_BODY_SHA256);
        expect(f.trace).toEqual(['preconditions']); expect(fetch).not.toHaveBeenCalled();
        expect(Object.keys(f.adapter).sort()).toEqual(['prepare', 'withValidatedRequest']);
        for (const name of ['fetch', 'dispatch', 'reserve', 'receipt', 'terminal', 'reset', 'write']) expect(name in f.adapter).toBe(false);
    });
    it('passes credentials only to an explicit synchronous consumer after complete contract/precondition PASS', () => {
        const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
        const f = fixture(), consume = vi.fn((prepared, credential) => { f.trace.push('consume'); expect(prepared.bodySHA256).toBe(RENDER_PLAN_PATCH_BODY_SHA256); expect(credential).toBe(KEY); });
        const result = f.adapter.withValidatedRequest(body(), RENDER_PLAN_PATCH_BODY_SHA256, consume);
        expect(f.trace).toEqual(['preconditions', 'credentials', 'consume']); expect(consume).toHaveBeenCalledTimes(1);
        expect(result.body).toBe(RENDER_PLAN_PATCH_BODY); expect(JSON.stringify(result)).not.toContain(KEY); expect(fetch).not.toHaveBeenCalled();
    });
    it('precondition failure reads no credentials and calls no consumer', () => {
        const f = fixture(), consume = vi.fn(); f.options.checkPreconditions.mockImplementation(() => { throw Error('local precondition failed'); });
        expect(() => f.adapter.withValidatedRequest(body(), RENDER_PLAN_PATCH_BODY_SHA256, consume)).toThrow('PRECONDITIONS_HOLD');
        expect(f.options.credentialReader).not.toHaveBeenCalled(); expect(consume).not.toHaveBeenCalled();
    });
    it('denies asynchronous preconditions before credential access', () => {
        const credentialReader = vi.fn(() => KEY), checkPreconditions = vi.fn(async () => {});
        const adapter = createRenderPlanPatchAdapter({ credentialReader, checkPreconditions });
        expect(() => adapter.withValidatedRequest(body(), RENDER_PLAN_PATCH_BODY_SHA256, vi.fn())).toThrow('PRECONDITIONS_HOLD');
        expect(credentialReader).not.toHaveBeenCalled();
    });
    it.each(['credentialReader', 'checkPreconditions'])('rejects option accessors for %s without invoking them', name => {
        const getter = vi.fn(), options = fixture().options;
        Object.defineProperty(options, name, { get: getter, enumerable: true });
        expect(() => createRenderPlanPatchAdapter(options)).toThrow('OWN_DATA_METHOD'); expect(getter).not.toHaveBeenCalled();
    });
    it('rejects Proxy options without invoking reflection traps or any port', () => {
        const f = fixture(), traps = {
            getPrototypeOf: vi.fn(Reflect.getPrototypeOf), ownKeys: vi.fn(Reflect.ownKeys),
            getOwnPropertyDescriptor: vi.fn(Reflect.getOwnPropertyDescriptor), get: vi.fn(Reflect.get),
        };
        expect(() => createRenderPlanPatchAdapter(new Proxy(f.options, traps as ProxyHandler<typeof f.options>))).toThrow('RENDER_PLAN_PATCH_OPTIONS');
        for (const trap of Object.values(traps)) expect(trap).not.toHaveBeenCalled();
        expect(f.trace).toEqual([]);
        const revoked = Proxy.revocable(f.options, {}); revoked.revoke();
        expect(() => createRenderPlanPatchAdapter(revoked.proxy)).toThrow('RENDER_PLAN_PATCH_OPTIONS');
        expect(f.trace).toEqual([]);
    });
    it.each(['credentialReader', 'checkPreconditions'])('rejects a function Proxy port without invoking it (%s)', name => {
        const f = fixture(), apply = vi.fn();
        const options = { ...f.options, [name]: new Proxy(f.options[name as keyof typeof f.options], { apply }) };
        expect(() => createRenderPlanPatchAdapter(options)).toThrow('OWN_DATA_METHOD');
        expect(apply).not.toHaveBeenCalled(); expect(f.trace).toEqual([]);
    });
    it('rejects standalone precondition and consumer function Proxies without invoking them', () => {
        const apply = vi.fn(), check = new Proxy(() => {}, { apply }), f = fixture();
        expect(() => prepareRenderPlanPatch(body(), RENDER_PLAN_PATCH_BODY_SHA256, check)).toThrow('PRECONDITIONS');
        expect(() => f.adapter.withValidatedRequest(body(), RENDER_PLAN_PATCH_BODY_SHA256, new Proxy(() => {}, { apply }))).toThrow('CONSUMER');
        expect(apply).not.toHaveBeenCalled(); expect(f.trace).toEqual([]);
    });
    it.each(['credentialReader', 'checkPreconditions'])('method replacement fails before credential access (%s)', name => {
        const f = fixture(), originalCredential = f.options.credentialReader, replacement = vi.fn(() => KEY);
        Object.defineProperty(f.options, name, { value: replacement });
        expect(() => f.adapter.withValidatedRequest(body(), RENDER_PLAN_PATCH_BODY_SHA256, vi.fn())).toThrow('METHOD_CHANGED');
        expect(originalCredential).not.toHaveBeenCalled(); expect(replacement).not.toHaveBeenCalled();
    });
    it('preconditions cannot replace the credential method before credential access', () => {
        const f = fixture(), credentialReader = f.options.credentialReader, replacement = vi.fn(() => KEY);
        f.options.checkPreconditions.mockImplementation(() => { f.options.credentialReader = replacement; });
        expect(() => f.adapter.withValidatedRequest(body(), RENDER_PLAN_PATCH_BODY_SHA256, vi.fn())).toThrow('PRECONDITIONS_HOLD');
        expect(credentialReader).not.toHaveBeenCalled(); expect(replacement).not.toHaveBeenCalled();
    });
    it.each(['extra-field', 'symbol-field', 'prototype'])('denies changed options shape before preconditions or credentials (%s)', change => {
        const f = fixture();
        if (change === 'prototype') Object.setPrototypeOf(f.options, { altered: true });
        else Object.defineProperty(f.options, change === 'symbol-field' ? Symbol('extra') : 'extra', { value: true });
        expect(() => f.adapter.withValidatedRequest(body(), RENDER_PLAN_PATCH_BODY_SHA256, vi.fn())).toThrow('RENDER_PLAN_PATCH_OPTIONS');
        expect(f.trace).toEqual([]);
    });
    it('denies an options symbol with a stable contract error rather than sorting it', () => {
        const options = { ...fixture().options, [Symbol('extra')]: true };
        expect(() => createRenderPlanPatchAdapter(options)).toThrow('RENDER_PLAN_PATCH_OPTIONS');
    });
    it('preconditions cannot change the options shape before credential access', () => {
        const f = fixture(); f.options.checkPreconditions.mockImplementation(() => { Object.defineProperty(f.options, 'extra', { value: true }); });
        expect(() => f.adapter.withValidatedRequest(body(), RENDER_PLAN_PATCH_BODY_SHA256, vi.fn())).toThrow('PRECONDITIONS_HOLD');
        expect(f.options.credentialReader).not.toHaveBeenCalled();
    });
    it('freezes public methods and rejects unexpected options', () => {
        const f = fixture(); expect(Object.isFrozen(f.adapter)).toBe(true);
        expect(() => Object.defineProperty(f.adapter, 'prepare', { value: vi.fn() })).toThrow();
        expect(() => createRenderPlanPatchAdapter({ ...f.options, fetch: vi.fn() } as never)).toThrow('OPTIONS');
    });
    it('does not return consumer values or credential-bearing exception details', () => {
        const f = fixture();
        expect(() => f.adapter.withValidatedRequest(body(), RENDER_PLAN_PATCH_BODY_SHA256, (() => KEY) as never)).toThrow('CREDENTIAL_GATE_HOLD');
        try { f.adapter.withValidatedRequest(body(), RENDER_PLAN_PATCH_BODY_SHA256, () => { throw Error(KEY); }); }
        catch (error) { expect((error as Error).message).toBe('RENDER_PLAN_PATCH_CREDENTIAL_GATE_HOLD'); }
    });
    it('leaves an existing local UNKNOWN_SPENT_STOP record byte-identical and creates no slot', () => {
        const path = mkdtempSync(join(tmpdir(), 'render-plan-contract-test-')); directories.push(path);
        const old = join(path, 'historical-old-b.json'), bytes = Buffer.from('{"status":"UNKNOWN_SPENT_STOP"}\n');
        writeFileSync(old, bytes, { mode: 0o600 }); const before = hash(readFileSync(old));
        const f = fixture(); f.adapter.prepare(body(), RENDER_PLAN_PATCH_BODY_SHA256);
        expect(readFileSync(old)).toEqual(bytes); expect(hash(readFileSync(old))).toBe(before);
        expect(f.options.credentialReader).not.toHaveBeenCalled();
    });
});
