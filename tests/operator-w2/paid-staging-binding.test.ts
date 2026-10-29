import { afterEach, describe, expect, it, vi } from 'vitest';
import { chmodSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createPaidStagingJournal, getPaidStagingJournalBinding } from '../../scripts/operator-w2/paid-staging-journal';
import { createPaidStagingBinding } from '../../scripts/operator-w2/paid-staging-binding';
import { createPaidStagingTerminalCollector } from '../../scripts/operator-w2/paid-staging-terminal';
import { PAID_STAGING_JOB_PLAN, PAID_STAGING_JOBS_URL, PAID_STAGING_SERVICE, PAID_STAGING_WORKSPACE, paidStagingRequestSHA256, type PaidStagingPrechecks } from '../../scripts/operator-w2/paid-staging-dispatcher';

const SHA = 'a'.repeat(40), H = 'b'.repeat(64), JOB = 'job-aaaaaaaaaaaaaaaaaaaa', KEY = 'synthetic-render-key-never-real';
const directories: string[] = [];
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
function directory() { const p = mkdtempSync(join(realpathSync(tmpdir()), 'paid-binding-test-')); chmodSync(p, 0o700); directories.push(p); return p; }
afterEach(() => { vi.useRealTimers(); for (const p of directories.splice(0)) rmSync(p, { recursive: true, force: true }); });
function fixture() {
    const base = directory(), request = { planId: PAID_STAGING_JOB_PLAN as typeof PAID_STAGING_JOB_PLAN, startCommand: 'node synthetic-readonly-capture.mjs' };
    const options = { mode: 'LOCAL_MOCK' as const, base, acceptanceVersion: 'test-v1', expectedApplicationSHA: SHA, planSHA256: H, request, expectedRequestSHA256: paidStagingRequestSHA256(request) };
    const journal = createPaidStagingJournal(options), namespace = join(base, readdirSync(base)[0]);
    const credentialReader = vi.fn(() => KEY);
    const job = { id: JOB, serviceId: PAID_STAGING_SERVICE, planId: PAID_STAGING_JOB_PLAN, startCommand: request.startCommand, status: 'pending' };
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => Response.json(init?.method === 'POST' ? job : { ...job, status: 'succeeded', startedAt: new Date().toISOString(), finishedAt: new Date().toISOString() }, { status: init?.method === 'POST' ? 201 : 200 }));
    const prechecks: Mutable<PaidStagingPrechecks> = { filesystem: () => { journal.inventory(); }, sourceCI: () => {}, journalInventory: () => {}, metadata: () => ({ serviceId: PAID_STAGING_SERVICE, workspaceId: PAID_STAGING_WORKSPACE, type: 'web_service', plan: '0.5c-512mb', region: 'frankfurt', runtime: 'docker', liveSHA: SHA, observedAt: new Date().toISOString(), eligible: true }), paidBase: () => {} };
    const bindingOptions = { mode: 'LOCAL_MOCK' as const, journal, acceptanceVersion: 'test-v1', expectedApplicationSHA: SHA, expectedPlanSHA256: H, expectedRequestSHA256: options.expectedRequestSHA256, prechecks, credentialReader, fetch, timeoutMs: 1000 };
    const record = (name: string) => join(namespace, 'capture-b', name + '.json');
    const accept = () => { journal.reserve('capture-b', null, options.expectedRequestSHA256); journal.receipt('capture-b', 'KNOWN_ACCEPTED', H, JOB, 201); };
    return { base, namespace, request, options, journal, credentialReader, job, fetch, prechecks, bindingOptions, record, accept, create: () => createPaidStagingBinding(bindingOptions) };
}
function canonical(v: unknown): string { if (v === null || typeof v !== 'object') return JSON.stringify(v); return '{' + Object.keys(v).sort((a,b) => a.localeCompare(b)).map(k => JSON.stringify(k) + ':' + canonical((v as Record<string,unknown>)[k])).join(',') + '}'; }
const hash = (v: unknown) => createHash('sha256').update(canonical(v)).digest('hex');
function terminalHash(e: {startCommand:string}, requestSHA256: string) { return hash({ ...e, startCommand: createHash('sha256').update(e.startCommand).digest('hex'), requestSHA256 }); }

describe('dedicated append-only staging acceptance journal', () => {
    it('creates a fresh pinned namespace without intent or external work', () => {
        const f = fixture(); expect(readdirSync(f.namespace)).toEqual(['binding.json']); expect(f.journal.inventory().records).toBe(0);
        expect(Object.keys(f.journal).sort()).toEqual(['inventory', 'read', 'receipt', 'reserve', 'terminal']); expect(Object.isFrozen(f.journal)).toBe(true);
        expect(lstatSync(f.base).mode & 0o777).toBe(0o700); expect(lstatSync(f.namespace).mode & 0o777).toBe(0o700);
        expect(lstatSync(join(f.namespace,'binding.json')).mode & 0o777).toBe(0o600);
        const binding = JSON.parse(readFileSync(join(f.namespace, 'binding.json'), 'utf8'));
        expect(binding).toMatchObject({ acceptanceVersion: 'test-v1', expectedSHA: SHA, planSHA256: H, requestSHA256: f.options.expectedRequestSHA256, serviceId: PAID_STAGING_SERVICE, workspaceId: PAID_STAGING_WORKSPACE });
        expect(f.credentialReader).not.toHaveBeenCalled(); expect(f.fetch).not.toHaveBeenCalled();
    });
    it('refuses an existing namespace even if unused, and an existing slot', () => {
        const f = fixture(); expect(() => createPaidStagingJournal(f.options)).toThrow('NAMESPACE_EXISTS');
        f.journal.reserve('capture-b', null, f.options.expectedRequestSHA256);
        const before = readFileSync(f.record('intent')); expect(() => f.journal.reserve('capture-b', null, f.options.expectedRequestSHA256)).toThrow('SPENT');
        expect(readFileSync(f.record('intent'))).toEqual(before); expect(f.journal.inventory().records).toBe(1);
    });
    it('has no production slots or reset/delete/overwrite/write/reopen API', () => {
        const f = fixture(); expect(() => f.journal.reserve('controls/env-warm' as never, null, H)).toThrow('SLOT');
        expect(Object.keys(f.journal)).not.toEqual(expect.arrayContaining(['write']));
        for (const key of ['reset','delete','overwrite','write','reopen']) expect(key in f.journal).toBe(false);
    });
    it.each(['mode','symlink','protected'])('refuses unsafe base (%s) before a namespace', kind => {
        const f = fixture(), base = directory();
        if (kind === 'mode') { chmodSync(base,0o755); expect(() => createPaidStagingJournal({...f.options,base})).toThrow(); }
        if (kind === 'symlink') { const alias = base + '-link'; symlinkSync(base,alias); directories.push(alias); expect(() => createPaidStagingJournal({...f.options,base:alias})).toThrow(); }
        if (kind === 'protected') expect(() => createPaidStagingJournal({...f.options,base:'/private/tmp/aca-v27-controlled-team'})).toThrow('PROTECTED_NAMESPACE');
        expect(readdirSync(base)).toEqual([]);
    });
    it.each(['symlink','hardlink','permissions','mutation','unknown'])('detects record tampering (%s)', kind => {
        const f = fixture(); f.journal.reserve('capture-b',null,f.options.expectedRequestSHA256); const file=f.record('intent');
        if(kind==='symlink'){const moved=join(f.base,'moved.json');renameSync(file,moved);symlinkSync(moved,file);}
        if(kind==='hardlink')linkSync(file,join(f.base,'linked.json'));
        if(kind==='permissions')chmodSync(file,0o644);
        if(kind==='mutation')writeFileSync(file,JSON.stringify({changed:true}));
        if(kind==='unknown')writeFileSync(join(f.namespace,'unexpected.json'),'{}',{mode:0o600});
        expect(()=>f.journal.inventory()).toThrow();
    });
    it('refuses a planted slot before reserve and a forged unknown suffix', () => {
        const f=fixture();mkdirSync(join(f.namespace,'capture-b'),{mode:0o700});
        expect(()=>f.journal.reserve('capture-b',null,f.options.expectedRequestSHA256)).toThrow();
        expect(()=>f.journal.read('capture-b','write' as never)).toThrow('SUFFIX');
    });
    it('reads exact durable intent and protects mode and request binding', () => {
        const f=fixture(),r=f.journal.reserve('capture-b',null,f.options.expectedRequestSHA256);
        expect(r).toMatchObject({status:'RESERVED_BEFORE_MUTATION',expectedSHA:SHA,planSHA256:H,requestSHA256:f.options.expectedRequestSHA256,evidenceSHA256:null,providerId:null,httpStatus:null,windowId:null});
        expect(f.journal.read('capture-b','intent')).toEqual(r);expect(JSON.parse(readFileSync(f.record('intent'),'utf8'))).toEqual(r);
        expect(lstatSync(f.record('intent')).mode&0o777).toBe(0o600);expect(lstatSync(join(f.namespace,'capture-b')).mode&0o777).toBe(0o700);
    });
    it('requires intent before receipt and KNOWN_ACCEPTED plus trusted proof before terminal', () => {
        const f=fixture();expect(()=>f.journal.receipt('capture-b','KNOWN_ACCEPTED',H,JOB,201)).toThrow('INTENT');
        expect(()=>f.journal.terminal('capture-b',H)).toThrow('ACCEPTED');
    });
    it('UNKNOWN receipt is append-only and can neither retry nor terminal', () => {
        const f=fixture();f.journal.reserve('capture-b',null,f.options.expectedRequestSHA256);f.journal.receipt('capture-b','UNKNOWN_SPENT_STOP',H);
        const before=readFileSync(f.record('receipt'));expect(()=>f.journal.reserve('capture-b',null,f.options.expectedRequestSHA256)).toThrow();
        expect(()=>f.journal.receipt('capture-b','KNOWN_ACCEPTED',H,JOB,201)).toThrow();expect(()=>f.journal.terminal('capture-b',H)).toThrow();expect(readFileSync(f.record('receipt'))).toEqual(before);
    });
    it('rejects request, source and plan mismatch before credentials/fetch', () => {
        const f=fixture();expect(()=>f.journal.reserve('capture-b',null,'c'.repeat(64))).toThrow('RESERVATION_BINDING');
        for(const patch of [{expectedApplicationSHA:'c'.repeat(40)},{expectedPlanSHA256:'c'.repeat(64)},{expectedRequestSHA256:'c'.repeat(64)},{acceptanceVersion:'other-v1'}])expect(()=>createPaidStagingBinding({...f.bindingOptions,...patch})).toThrow('EXACT_SCOPE');
        expect(()=>createPaidStagingJournal({...f.options,base:directory(),expectedRequestSHA256:H})).toThrow('REQUEST_SHA');
        expect(f.credentialReader).not.toHaveBeenCalled();expect(f.fetch).not.toHaveBeenCalled();
    });
    it('rejects constructor/accessor attacks without invoking them', () => {
        const f=fixture(),getter=vi.fn();const options={...f.options,base:directory()};Object.defineProperty(options,'request',{get:getter});
        expect(()=>createPaidStagingJournal(options)).toThrow();expect(getter).not.toHaveBeenCalled();
        const bindingOptions={...f.bindingOptions};Object.defineProperty(bindingOptions,'credentialReader',{get:getter});expect(()=>createPaidStagingBinding(bindingOptions)).toThrow();expect(getter).not.toHaveBeenCalled();
        expect(()=>createPaidStagingBinding({...f.bindingOptions,journal:{...f.journal}})).toThrow('OWNED_JOURNAL');
    });
    it('freezes journal methods against replacement and preserves old B bytes', () => {
        const f=fixture(),old=join(f.base,'historical-old-b.json'),bytes=Buffer.from('{"status":"UNKNOWN_SPENT_STOP"}\n');writeFileSync(old,bytes,{mode:0o600});
        expect(()=>Object.defineProperty(f.journal,'reserve',{value:vi.fn()})).toThrow();
        f.journal.reserve('capture-b',null,f.options.expectedRequestSHA256);expect(readFileSync(old)).toEqual(bytes);
    });
});

describe('dispatcher bound to the real dedicated journal and terminal provenance', () => {
    it('constructs inertly and proves reserve → POST → receipt → GET → terminal', async () => {
        const f=fixture();let credentialCalls=0;
        f.bindingOptions.credentialReader=vi.fn(()=>{credentialCalls++;expect(f.journal.read('capture-b','intent')?.status).toBe('RESERVED_BEFORE_MUTATION');if(credentialCalls===2)expect(f.journal.read('capture-b','receipt')?.status).toBe('KNOWN_ACCEPTED');return KEY;});
        const binding=f.create();expect(f.fetch).not.toHaveBeenCalled();expect(f.journal.inventory().records).toBe(0);
        await binding.dispatch();expect(f.fetch).toHaveBeenCalledTimes(1);expect(f.journal.read('capture-b','receipt')?.status).toBe('KNOWN_ACCEPTED');expect(f.journal.read('capture-b','terminal')).toBeUndefined();
        expect(binding.state().status).toBe('KNOWN_ACCEPTED');const result=await binding.collectTerminal();expect(result.status).toBe('TERMINAL_SUCCEEDED');
        expect(f.fetch.mock.calls.map(c=>[String(c[0]),c[1]?.method])).toEqual([[PAID_STAGING_JOBS_URL,'POST'],[PAID_STAGING_JOBS_URL+'/'+JOB,'GET']]);
        expect(f.journal.inventory().records).toBe(3);expect(binding.state().status).toBe('TERMINAL_SUCCEEDED');
        await expect(binding.collectTerminal()).rejects.toThrow('HOLD_STOP');await expect(binding.dispatch()).rejects.toThrow('HOLD_STOP');expect(f.fetch).toHaveBeenCalledTimes(2);
    });
    it('reserve failure keeps credential/fetch zero',async()=>{
        const f=fixture(),binding=f.create();f.prechecks.paidBase=()=>{mkdirSync(join(f.namespace,'capture-b'),{mode:0o700});};
        await expect(binding.dispatch()).rejects.toThrow('DISPATCH_HOLD');expect(f.credentialReader).not.toHaveBeenCalled();expect(f.fetch).not.toHaveBeenCalled();expect(binding.state().status).toBe('HOLD');
    });
    it('blocks caller manufactured terminal hash even with KNOWN_ACCEPTED',()=>{
        const f=fixture();f.accept();expect(()=>f.journal.terminal('capture-b',H)).toThrow();expect(f.journal.read('capture-b','terminal')).toBeUndefined();expect(f.fetch).not.toHaveBeenCalled();
    });
    it.each(['failed','canceled','running','pending','unknown'])('terminal %s HOLDs, leaves receipt intact and never retries',async status=>{
        const f=fixture(),binding=f.create();await binding.dispatch();const before=readFileSync(f.record('receipt'));
        f.fetch.mockResolvedValue(Response.json({...f.job,status,startedAt:new Date().toISOString(),finishedAt:new Date().toISOString()}));
        await expect(binding.collectTerminal()).rejects.toThrow('TERMINAL_HOLD');expect(binding.state().status).toBe('HOLD');expect(readFileSync(f.record('receipt'))).toEqual(before);expect(f.journal.read('capture-b','terminal')).toBeUndefined();
        const collector=createPaidStagingTerminalCollector({journal:f.journal,credentialReader:f.credentialReader,fetch:f.fetch});await expect(collector.collect()).rejects.toThrow();expect(f.fetch).toHaveBeenCalledTimes(2);
    });
    it.each(['id','service','plan','command','future','old','malformed','HTTP','throw','oversized'])('rejects invalid/unavailable terminal evidence (%s)',async kind=>{
        const f=fixture(),binding=f.create();await binding.dispatch();const now=new Date().toISOString();
        const patch={id:{id:'job-foreignforeign'},service:{serviceId:'srv-foreign'},plan:{planId:'plan-foreign'},command:{startCommand:'wrong'},future:{finishedAt:'2099-01-01T00:00:00Z'},old:{startedAt:'2000-01-01T00:00:00Z'}}[kind];
        f.fetch.mockImplementation(async()=>{if(kind==='throw')throw Error(KEY);if(kind==='HTTP')return new Response('',{status:503});if(kind==='malformed')return new Response('{');if(kind==='oversized')return new Response('x'.repeat(65537));return Response.json({...f.job,status:'succeeded',startedAt:now,finishedAt:now,...patch});});
        await expect(binding.collectTerminal()).rejects.toThrow('TERMINAL_HOLD');expect(f.journal.read('capture-b','receipt')?.status).toBe('KNOWN_ACCEPTED');expect(f.journal.read('capture-b','terminal')).toBeUndefined();expect(f.fetch).toHaveBeenCalledTimes(2);
        expect(JSON.stringify(binding.state())).not.toContain(KEY);
    });
    it('collector refuses UNKNOWN receipt before credential/fetch',async()=>{
        const f=fixture();f.journal.reserve('capture-b',null,f.options.expectedRequestSHA256);f.journal.receipt('capture-b','UNKNOWN_SPENT_STOP',H);
        const collector=createPaidStagingTerminalCollector({journal:f.journal,credentialReader:f.credentialReader,fetch:f.fetch});await expect(collector.collect()).rejects.toThrow();expect(f.credentialReader).not.toHaveBeenCalled();expect(f.fetch).not.toHaveBeenCalled();
    });
    it('an unavailable terminal response times out once and late success cannot mint proof',async()=>{
        const f=fixture();vi.useFakeTimers();const binding=f.create();await binding.dispatch();let respond!:(r:Response)=>void;
        f.fetch.mockImplementation(()=>new Promise(resolve=>{respond=resolve;}));const result=binding.collectTerminal().catch(e=>e);await vi.advanceTimersByTimeAsync(1001);expect((await result).message).toContain('TERMINAL_HOLD');
        respond(Response.json({...f.job,status:'succeeded',startedAt:new Date().toISOString(),finishedAt:new Date().toISOString()}));await Promise.resolve();await Promise.resolve();expect(f.journal.read('capture-b','terminal')).toBeUndefined();
        await expect(binding.collectTerminal()).rejects.toThrow('HOLD_STOP');expect(f.fetch).toHaveBeenCalledTimes(2);
    });
    it('proof cannot cross journal identity and expires after its fresh GET',async()=>{
        const f=fixture();f.accept();let now=Date.now();f.fetch.mockImplementation(async()=>Response.json({...f.job,status:'succeeded',startedAt:new Date(now).toISOString(),finishedAt:new Date(now).toISOString()}));const collector=createPaidStagingTerminalCollector({journal:f.journal,credentialReader:f.credentialReader,fetch:f.fetch,now:()=>now});const evidence=await collector.collect(),proof=terminalHash(evidence,f.options.expectedRequestSHA256);
        const foreign=fixture();foreign.accept();expect(()=>foreign.journal.terminal('capture-b',proof)).toThrow();
        now+=60001;expect(()=>f.journal.terminal('capture-b',proof)).toThrow();expect(f.journal.read('capture-b','terminal')).toBeUndefined();
    });
    it('collector option replacement and accessor attacks fail closed',async()=>{
        const f=fixture();f.accept();const getter=vi.fn(),bad={journal:f.journal,credentialReader:f.credentialReader,fetch:f.fetch};Object.defineProperty(bad,'credentialReader',{get:getter});expect(()=>createPaidStagingTerminalCollector(bad)).toThrow();expect(getter).not.toHaveBeenCalled();
        const options={journal:f.journal,credentialReader:f.credentialReader,fetch:f.fetch},collector=createPaidStagingTerminalCollector(options),evil=vi.fn();options.fetch=evil;await expect(collector.collect()).rejects.toThrow();expect(evil).not.toHaveBeenCalled();expect(f.credentialReader).not.toHaveBeenCalled();
    });
    it('mock collection requires an explicit mock transport and never defaults to network',()=>{
        const f=fixture();expect(()=>createPaidStagingTerminalCollector({journal:f.journal,credentialReader:f.credentialReader})).toThrow('MOCK_FETCH');expect(f.credentialReader).not.toHaveBeenCalled();expect(f.fetch).not.toHaveBeenCalled();
    });
    it('cannot promote a mock journal to hosted mode or substitute a fabricated journal',()=>{
        const f=fixture();expect(()=>createPaidStagingBinding({...f.bindingOptions,mode:'HOSTED_STAGING'} as never)).toThrow('MODE');
        expect(()=>createPaidStagingTerminalCollector({journal:{...f.journal},credentialReader:f.credentialReader,fetch:f.fetch})).toThrow('OWNED_JOURNAL');
        expect(Object.isFrozen(getPaidStagingJournalBinding(f.journal))).toBe(true);expect(f.credentialReader).not.toHaveBeenCalled();expect(f.fetch).not.toHaveBeenCalled();
    });
    it('rejects impossible calendar dates rather than normalizing them into fresh timestamps',async()=>{
        vi.useFakeTimers();vi.setSystemTime(new Date('2027-03-02T12:00:00Z'));const f=fixture(),binding=f.create();await binding.dispatch();
        f.fetch.mockResolvedValue(Response.json({...f.job,status:'succeeded',startedAt:'2027-02-30T12:00:00Z',finishedAt:'2027-02-30T12:00:00Z'}));
        await expect(binding.collectTerminal()).rejects.toThrow('TERMINAL_HOLD');expect(f.journal.read('capture-b','terminal')).toBeUndefined();expect(f.journal.read('capture-b','receipt')?.status).toBe('KNOWN_ACCEPTED');
    });
});
