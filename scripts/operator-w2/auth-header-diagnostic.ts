import { createHmac, randomBytes } from 'node:crypto';
import { z } from 'zod';

// A diagnostic binding, never a controlled Team/W2 admission scope. There is no
// credential loader, journal, operator import, mutation or default fetch here.
export const AUTH_HEADER_DIAGNOSTIC = Object.freeze({
  project: 'vflgxgdwlftlyjslyrmo',
  runId: '00000000-0000-4000-8000-0000000000d1',
  participantId: '00000000-0000-4000-8000-0000000000d2',
  userId: '00000000-0000-4000-8000-0000000000d3',
} as const);

const resultSchema = z.strictObject({
  authorization_matched: z.boolean(),
  apikey_matched: z.boolean(),
  run_id: z.literal(AUTH_HEADER_DIAGNOSTIC.runId),
  window_id: z.null(),
  participant_id: z.literal(AUTH_HEADER_DIAGNOSTIC.participantId),
  user_id: z.literal(AUTH_HEADER_DIAGNOSTIC.userId),
  operation: z.literal('capability'),
  reservation_id: z.null(),
  diagnostic_only: z.literal(true),
  server_now: z.iso.datetime({ offset: true }),
});

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
  } catch {
    cancel();
    throw Error();
  } finally {
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}

/** One read-only paired challenge through the actual staging HTTP headers.
 * HMAC values and key material never appear in the returned receipt or errors.
 * The caller must durably record its own one-shot intent before calling run(). */
export function createStagingAuthHeaderDiagnostic(options: {
  project: string;
  serviceRole: string;
  fetch: typeof fetch;
}) {
  if (options.project !== AUTH_HEADER_DIAGNOSTIC.project ||
      typeof options.fetch !== 'function' || typeof options.serviceRole !== 'string' ||
      !/^[A-Za-z0-9._-]{20,4096}$/.test(options.serviceRole)) {
    throw Error('auth_header_diagnostic_configuration_denied');
  }
  const key = options.serviceRole, fetchImpl = options.fetch;
  let spent = false;
  return Object.freeze({ async run() {
    if (spent) throw Error('auth_header_diagnostic_attempt_spent');
    spent = true;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const challenge = randomBytes(32).toString('hex');
      const message = ['aca-w2-auth-evidence-v1', 'challenge',
        AUTH_HEADER_DIAGNOSTIC.runId, '-', AUTH_HEADER_DIAGNOSTIC.participantId,
        AUTH_HEADER_DIAGNOSTIC.userId, 'capability', '-', challenge].join('\n');
      const body = {
        p_run_id: AUTH_HEADER_DIAGNOSTIC.runId, p_window_id: null,
        p_participant_id: AUTH_HEADER_DIAGNOSTIC.participantId,
        p_user_id: AUTH_HEADER_DIAGNOSTIC.userId, p_operation: 'capability',
        p_reservation_id: null, p_challenge: challenge,
        p_authorization_mac: createHmac('sha256', 'Bearer ' + key).update(message, 'utf8').digest('hex'),
        p_apikey_mac: createHmac('sha256', key).update(message, 'utf8').digest('hex'),
      };
      const startedAt = new Date().toISOString();
      const value = await Promise.race([(async () => {
        const response = await fetchImpl(`https://${AUTH_HEADER_DIAGNOSTIC.project}.supabase.co/rest/v1/rpc/check_controlled_team_auth_header_capability`, {
          method: 'POST', headers: { Authorization: 'Bearer ' + key, apikey: key, 'Content-Type': 'application/json' },
          body: JSON.stringify(body), redirect: 'error', cache: 'no-store', signal: controller.signal,
        });
        if (response.redirected || response.status !== 200) throw Error();
        return resultSchema.parse(await boundedJSON(response, controller.signal));
      })(), new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(Error()); }, 30000);
      })]);
      const confirmed = !value.authorization_matched && value.apikey_matched;
      return Object.freeze({
        status: confirmed ? 'V27_TEAM_W2_AUTH_HEADER_ROOT_CAUSE_CONFIRMED' as const : 'V27_TEAM_W2_AUTH_HEADER_DIAGNOSTIC_HOLD' as const,
        project: AUTH_HEADER_DIAGNOSTIC.project, startedAt, finishedAt: new Date().toISOString(),
        serverNow: value.server_now, HTTPStatus: 200, authorizationMatched: value.authorization_matched,
        apikeyMatched: value.apikey_matched, scopeMatches: true, diagnosticOnly: true,
        evidence: confirmed ? 'AUTHORIZATION_REPRESENTATION_DIFFERS_WHILE_APIKEY_MATCHES' : 'REQUIRED_HEADER_DIFFERENCE_NOT_CONFIRMED',
        qualification: 'Staging request-header comparison only; no particular gateway hop, production result, W2 admission, credential issuance or verification is attested.',
        actualPOSTs: 1, retries: 0, W2Authorized: false,
      });
    } catch {
      controller.abort();
      throw Error('auth_header_diagnostic_unknown_STOP');
    } finally {
      clearTimeout(timer);
    }
  } });
}
