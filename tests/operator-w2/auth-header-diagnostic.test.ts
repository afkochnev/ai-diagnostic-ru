import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUTH_HEADER_DIAGNOSTIC as scope, createStagingAuthHeaderDiagnostic } from '../../scripts/operator-w2/auth-header-diagnostic';

const key = 'synthetic-existing-service-role-' + 'k'.repeat(40);
const result = (authorization = false, apikey = true) => ({
  authorization_matched: authorization, apikey_matched: apikey, run_id: scope.runId,
  window_id: null, participant_id: scope.participantId, user_id: scope.userId,
  operation: 'capability', reservation_id: null, diagnostic_only: true, server_now: new Date().toISOString(),
});
const create = (fetchImpl: typeof fetch) => createStagingAuthHeaderDiagnostic({ project: scope.project, serviceRole: key, fetch: fetchImpl });
afterEach(() => vi.useRealTimers());

describe('inert fixed-staging paired Auth header diagnostic', () => {
  it('uses exactly the same actual headers, fresh challenge and message for both MACs without exporting them', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(result())));
    const diagnostic = create(fetchImpl);
    expect(fetchImpl).not.toHaveBeenCalled();
    const receipt = await diagnostic.run();
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`https://${scope.project}.supabase.co/rest/v1/rpc/check_controlled_team_auth_header_capability`);
    expect(init).toMatchObject({ method: 'POST', redirect: 'error', cache: 'no-store', headers: { Authorization: 'Bearer ' + key, apikey: key } });
    const body = JSON.parse(String(init?.body));
    expect(Object.keys(body).sort()).toEqual(['p_apikey_mac', 'p_authorization_mac', 'p_challenge', 'p_operation', 'p_participant_id', 'p_reservation_id', 'p_run_id', 'p_user_id', 'p_window_id']);
    expect(body.p_challenge).toMatch(/^[a-f0-9]{64}$/);
    const message = ['aca-w2-auth-evidence-v1', 'challenge', scope.runId, '-', scope.participantId, scope.userId, 'capability', '-', body.p_challenge].join('\n');
    expect(body.p_authorization_mac).toBe(createHmac('sha256', 'Bearer ' + key).update(message).digest('hex'));
    expect(body.p_apikey_mac).toBe(createHmac('sha256', key).update(message).digest('hex'));
    expect(body.p_apikey_mac).not.toBe(body.p_authorization_mac);
    expect(JSON.stringify(body)).not.toContain(key);
    expect(receipt.status).toBe('V27_TEAM_W2_AUTH_HEADER_ROOT_CAUSE_CONFIRMED');
    for (const secret of [key, body.p_challenge, body.p_authorization_mac, body.p_apikey_mac]) expect(JSON.stringify(receipt)).not.toContain(secret);
    await expect(diagnostic.run()).rejects.toThrow('attempt_spent');
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it.each([[false, false], [true, false], [true, true]])('holds for all other boolean outcomes %s/%s', async (authorization, apikey) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(result(authorization, apikey))));
    expect((await create(fetchImpl).run()).status).toBe('V27_TEAM_W2_AUTH_HEADER_DIAGNOSTIC_HOLD');
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it('rejects production, caller mutation and malformed keys before dispatch', () => {
    const fetchImpl = vi.fn<typeof fetch>();
    for (const project of ['fhvxqeaujjeiflanqsbg', 'https://' + scope.project, scope.project + '/auth'])
      expect(() => createStagingAuthHeaderDiagnostic({ project, serviceRole: key, fetch: fetchImpl })).toThrow('configuration_denied');
    for (const serviceRole of ['', 'Bearer ' + key, key + '\n', 'short'])
      expect(() => createStagingAuthHeaderDiagnostic({ project: scope.project, serviceRole, fetch: fetchImpl })).toThrow('configuration_denied');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it.each(['scope', 'extra', 'diagnostic', 'operation', 'bad_json', 'private_error', 'HTTP', 'oversize'])('fails closed and redacts %s without retry', async kind => {
    const value = { ...result(), ...(kind === 'scope' ? { user_id: scope.runId } : {}), ...(kind === 'extra' ? { key } : {}), ...(kind === 'diagnostic' ? { diagnostic_only: false } : {}), ...(kind === 'operation' ? { operation: 'issue' } : {}) };
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => {
      if (kind === 'private_error') throw Error(key);
      return new Response(kind === 'bad_json' ? key : kind === 'oversize' ? 'x'.repeat(8193) : JSON.stringify(value), { status: kind === 'HTTP' ? 500 : 200 });
    });
    const diagnostic = create(fetchImpl), error = await diagnostic.run().catch(e => e as Error);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('auth_header_diagnostic_unknown_STOP');
    expect(String(error)).not.toContain(key);
    await expect(diagnostic.run()).rejects.toThrow('attempt_spent');
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it('bounds a hung request, aborts, and retains the spent attempt', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation((_url, init) => { signal = init?.signal ?? undefined; return new Promise(() => {}); });
    const diagnostic = create(fetchImpl), pending = diagnostic.run().catch(e => e as Error);
    await vi.advanceTimersByTimeAsync(30000);
    expect((await pending as Error).message).toBe('auth_header_diagnostic_unknown_STOP');
    expect(signal?.aborted).toBe(true);
    await expect(diagnostic.run()).rejects.toThrow('attempt_spent');
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
