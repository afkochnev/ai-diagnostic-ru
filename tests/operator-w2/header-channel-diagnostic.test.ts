import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUTH_HEADER_DIAGNOSTIC as scope } from '../../scripts/operator-w2/auth-header-diagnostic';
import { classifyProtectedServiceKey, createStagingHeaderChannelDiagnostic } from '../../scripts/operator-w2/header-channel-diagnostic';
const key = 'sb_secret_' + 'syntheticexistingkey'.repeat(3);
const value = () => ({ authorization_class: 'bearer_jwt', apikey_class: 'jwt',
  authorization_payload_equals_apikey: true, jwt_role_is_service_role: true,
  authorization_present: true, apikey_present: true, custom_probe_matched: true });
const create = (fetchImpl: typeof fetch, serviceRole = key) => createStagingHeaderChannelDiagnostic({ project: scope.project, serviceRole, fetch: fetchImpl });
afterEach(() => vi.useRealTimers());
describe('staging-only header classifications and ephemeral transport probe', () => {
  it.each([[key, 'sb_secret'], ['AAA_BBB.CCC_DDD.EEE_FFF', 'legacy_jwt'], ['opaque-existing-service-role-key', 'other'], ['sb_secret_', 'other'], ['a.b', 'other'], ['a.b.c.d', 'other']])('classifies only an allowed enum', (input, expected) => {
    expect(classifyProtectedServiceKey(input)).toBe(expected);
  });
  it('is inert and makes one request with independent fresh256bit header key and nonce; exports neither', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(value()))), diagnostic = create(fetchImpl);
    expect(fetchImpl).not.toHaveBeenCalled();expect(Object.keys(diagnostic)).toEqual(['nodeKeyClass', 'run']);
    const receipt = await diagnostic.run(), [url, init] = fetchImpl.mock.calls[0], headers = new Headers(init?.headers);
    expect(url).toBe(`https://${scope.project}.supabase.co/rest/v1/rpc/inspect_controlled_team_auth_header_channels`);
    expect(init).toMatchObject({ method: 'POST', redirect: 'error', cache: 'no-store' });
    const probe = headers.get('x-aca-w2-probe')!, body = JSON.parse(String(init?.body));
    expect(probe).toMatch(/^[a-f0-9]{64}$/);expect(body.p_challenge).toMatch(/^[a-f0-9]{64}$/);expect(probe).not.toBe(body.p_challenge);
    expect(headers.get('authorization')).toBe('Bearer ' + key);expect(headers.get('apikey')).toBe(key);
    expect(Object.keys(body).sort()).toEqual(['p_challenge', 'p_custom_probe_mac', 'p_operation', 'p_participant_id', 'p_reservation_id', 'p_run_id', 'p_user_id', 'p_window_id']);
    const message = ['aca-w2-header-channel-diagnostic-v2', 'challenge', scope.runId, '-', scope.participantId, scope.userId, 'capability', '-', body.p_challenge].join('\n');
    expect(body.p_custom_probe_mac).toBe(createHmac('sha256', probe).update(message).digest('hex'));
    for (const secret of [key, probe]) expect(JSON.stringify(body)).not.toContain(secret);
    for (const secret of [key, probe, body.p_challenge, body.p_custom_probe_mac]) expect(JSON.stringify(receipt)).not.toContain(secret);
    expect(Object.keys(receipt.classification).sort()).toEqual(Object.keys(value()).sort());
    expect(receipt.status).toBe('V27_TEAM_W2_AUTH_GATEWAY_TRANSLATION_CONFIRMED');
    expect(receipt.architectureImplementationAuthorized).toBe(false);
    await expect(diagnostic.run()).rejects.toThrow('attempt_spent');expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it('stops header-dependent attempts whenever custom HMAC fails, with no fallback', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ ...value(), custom_probe_matched: false })));
    const r = await create(fetchImpl).run();expect(r.status).toBe('V27_TEAM_W2_REQUEST_HEADER_CHANNEL_UNSUITABLE_HOLD');
    expect(r.requestHeadersMayBeUsedAsSharedHMACKeyChannel).toBe('STOP_HEADER_DEPENDENT_ATTEMPTS');expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it.each(['node_jwt', 'node_other', 'non_equal', 'wrong_role', 'sb_secret_headers', 'absent_headers'])('keeps ambiguous %s observations on HOLD', async kind => {
    const response = { ...value(), ...(kind === 'non_equal' ? { authorization_payload_equals_apikey: false } : {}),
      ...(kind === 'wrong_role' ? { jwt_role_is_service_role: false } : {}),
      ...(kind === 'sb_secret_headers' ? { authorization_class: 'bearer_sb_secret', apikey_class: 'sb_secret' } : {}),
      ...(kind === 'absent_headers' ? { authorization_class: 'absent', apikey_class: 'absent', authorization_present: false, apikey_present: false, authorization_payload_equals_apikey: false } : {}) };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(response)));
    const r = await create(fetchImpl, kind === 'node_jwt' ? 'AAA_BBB.CCC_DDD.EEE_FFF' : kind === 'node_other' ? 'opaque-existing-service-role-key' : key).run();
    expect(r.status).toBe('V27_TEAM_W2_AUTH_HEADER_DIAGNOSTIC_HOLD');expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it('rejects a production project before dispatch', () => {
    const fetchImpl = vi.fn<typeof fetch>();expect(() => createStagingHeaderChannelDiagnostic({ project: 'fhvxqeaujjeiflanqsbg', serviceRole: key, fetch: fetchImpl })).toThrow('configuration_denied');expect(fetchImpl).not.toHaveBeenCalled();
  });
  it.each(['extra', 'bad_class', 'bad_presence', 'bad_equality', 'HTTP', 'redirect', 'oversize', 'private_error', 'bad_json'])('redacts %s and never retries', async kind => {
    let probe = '', body: Record<string, string> = {};
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      probe = new Headers(init?.headers).get('x-aca-w2-probe')!;body = JSON.parse(String(init?.body));
      if (kind === 'private_error') throw Error(key + probe + body.p_custom_probe_mac);
      const data = { ...value(), ...(kind === 'extra' ? { raw_header: key + probe } : {}), ...(kind === 'bad_class' ? { apikey_class: 'secret_fragment' } : {}),
        ...(kind === 'bad_presence' ? { apikey_present: false } : {}), ...(kind === 'bad_equality' ? { apikey_class: 'sb_secret' } : {}) };
      const response = new Response(kind === 'oversize' ? 'x'.repeat(8193) : kind === 'bad_json' ? key + probe : JSON.stringify(data), { status: kind === 'HTTP' ? 500 : 200 });
      if (kind === 'redirect') Object.defineProperty(response, 'redirected', { value: true });
      return response;
    });
    const diagnostic = create(fetchImpl), error = await diagnostic.run().catch(e => e as Error);
    expect(error).toBeInstanceOf(Error);expect((error as Error).message).toBe('header_channel_diagnostic_unknown_STOP');
    for (const secret of [key, probe, body.p_custom_probe_mac]) expect(String(error)).not.toContain(secret);
    await expect(diagnostic.run()).rejects.toThrow('attempt_spent');expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it('bounds a hung fetch and retains the spent attempt', async () => {
    vi.useFakeTimers();let signal: AbortSignal | undefined;
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation((_url, init) => { signal = init?.signal ?? undefined;return new Promise(() => {}); });
    const diagnostic = create(fetchImpl), pending = diagnostic.run().catch(e => e as Error);await vi.advanceTimersByTimeAsync(30000);
    expect((await pending as Error).message).toBe('header_channel_diagnostic_unknown_STOP');expect(signal?.aborted).toBe(true);
    await expect(diagnostic.run()).rejects.toThrow('attempt_spent');expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
