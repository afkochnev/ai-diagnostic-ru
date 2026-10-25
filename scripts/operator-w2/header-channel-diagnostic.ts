import { createHmac, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { AUTH_HEADER_DIAGNOSTIC as scope } from './auth-header-diagnostic';

const compactJWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
export function classifyProtectedServiceKey(key: string): 'sb_secret' | 'legacy_jwt' | 'other' {
  if (/^sb_secret_[A-Za-z0-9_-]+$/.test(key)) return 'sb_secret';
  return compactJWT.test(key) ? 'legacy_jwt' : 'other';
}
const responseSchema = z.strictObject({
  authorization_class: z.enum(['absent', 'bearer_jwt', 'bearer_sb_secret', 'bearer_other', 'non_bearer']),
  apikey_class: z.enum(['absent', 'jwt', 'sb_secret', 'sb_publishable', 'other']),
  authorization_payload_equals_apikey: z.boolean(),
  jwt_role_is_service_role: z.boolean(),
  authorization_present: z.boolean(),
  apikey_present: z.boolean(),
  custom_probe_matched: z.boolean(),
}).refine(x => x.authorization_present === (x.authorization_class !== 'absent') &&
  x.apikey_present === (x.apikey_class !== 'absent') &&
  (!x.authorization_payload_equals_apikey || x.authorization_present && x.apikey_present &&
    (x.authorization_class === 'bearer_jwt' && x.apikey_class === 'jwt' ||
     x.authorization_class === 'bearer_sb_secret' && x.apikey_class === 'sb_secret' ||
     x.authorization_class === 'bearer_other' && ['other', 'sb_publishable'].includes(x.apikey_class))));

async function boundedJSON(response: Response, signal: AbortSignal) {
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > 8192)) throw Error();
  if (!response.body) throw Error();
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let bytes = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    for (;;) {
      const next = await reader.read();
      if (signal.aborted) throw Error();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > 8192) throw Error();
      chunks.push(next.value);
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, bytes)));
  } catch { cancel(); throw Error(); }
  finally { signal.removeEventListener('abort', cancel); reader.releaseLock(); }
}

/** Inert, staging-only classification and transport probe. The random custom
 * header is not a credential or a persistent secret, and never becomes a W2 key.
 * A caller must durably record one exclusive attempt before run(). No request
 * body/header/MAC/key/nonce/length/fingerprint escapes in receipts or errors. */
export function createStagingHeaderChannelDiagnostic(options: {
  project: string; serviceRole: string; fetch: typeof fetch;
}) {
  if (options.project !== scope.project || typeof options.fetch !== 'function' ||
      typeof options.serviceRole !== 'string' || !/^[A-Za-z0-9._-]{20,4096}$/.test(options.serviceRole))
    throw Error('header_channel_diagnostic_configuration_denied');
  const key = options.serviceRole, fetchImpl = options.fetch, nodeKeyClass = classifyProtectedServiceKey(key);
  let spent = false;
  return Object.freeze({ nodeKeyClass, async run() {
    if (spent) throw Error('header_channel_diagnostic_attempt_spent');
    spent = true;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // Independent entropy: the nonce goes in RPC args; the HMAC key travels
      // only in this request header. Neither is returned or recorded by us.
      const probe = randomBytes(32).toString('hex'), challenge = randomBytes(32).toString('hex');
      const message = ['aca-w2-header-channel-diagnostic-v2', 'challenge', scope.runId, '-',
        scope.participantId, scope.userId, 'capability', '-', challenge].join('\n');
      const body = { p_run_id: scope.runId, p_window_id: null, p_participant_id: scope.participantId,
        p_user_id: scope.userId, p_operation: 'capability', p_reservation_id: null, p_challenge: challenge,
        p_custom_probe_mac: createHmac('sha256', probe).update(message, 'utf8').digest('hex') };
      const startedAt = new Date().toISOString();
      const classification = await Promise.race([(async () => {
        const response = await fetchImpl(`https://${scope.project}.supabase.co/rest/v1/rpc/inspect_controlled_team_auth_header_channels`, {
          method: 'POST', headers: { Authorization: 'Bearer ' + key, apikey: key,
            'x-aca-w2-probe': probe, 'Content-Type': 'application/json' },
          body: JSON.stringify(body), redirect: 'error', cache: 'no-store', signal: controller.signal,
        });
        if (response.redirected || response.status !== 200) throw Error();
        return responseSchema.parse(await boundedJSON(response, controller.signal));
      })(), new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(Error()); }, 30000);
      })]);
      const translation = nodeKeyClass === 'sb_secret' && classification.authorization_class === 'bearer_jwt' &&
        classification.apikey_class === 'jwt' && classification.authorization_payload_equals_apikey &&
        classification.jwt_role_is_service_role && classification.authorization_present && classification.apikey_present;
      const status = !classification.custom_probe_matched ? 'V27_TEAM_W2_REQUEST_HEADER_CHANNEL_UNSUITABLE_HOLD' as const :
        translation ? 'V27_TEAM_W2_AUTH_GATEWAY_TRANSLATION_CONFIRMED' as const : 'V27_TEAM_W2_AUTH_HEADER_DIAGNOSTIC_HOLD' as const;
      return Object.freeze({ status, project: scope.project, nodeKeyClass, classification,
        HTTPStatus: 200, startedAt, finishedAt: new Date().toISOString(), actualPOSTs: 1, retries: 0,
        qualification: 'Staging downstream representation and diagnostic channel only; no particular gateway hop, production security mechanism or W2 admission is established.',
        requestHeadersMayBeUsedAsSharedHMACKeyChannel: classification.custom_probe_matched ? 'NOT_AUTHORIZED_DIAGNOSTIC_ONLY' : 'STOP_HEADER_DEPENDENT_ATTEMPTS',
        W2Authorized: false, architectureImplementationAuthorized: false });
    } catch { controller.abort(); throw Error('header_channel_diagnostic_unknown_STOP'); }
    finally { clearTimeout(timer); }
  } });
}
