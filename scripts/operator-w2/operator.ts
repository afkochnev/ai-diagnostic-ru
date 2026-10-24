import { accessJob, controls, createFiniteTransport, databaseAction, workerJob, type Capability, type Preimage, type TransportMode } from './capabilities';
import { FIXED, PARTICIPANTS, WEB, digest, need, scope, slot, type Scope, type Slot, type W2Plan } from './contract';
import { openRootJournal, assertOwnedJournal, type Journal, type JournalRecord } from './journal';
import { collectReadiness, consumeReadiness, observedReadiness, readinessSummary, type CollectorOptions, type Readiness } from './readiness';
import { fixtureAnswerExpectation, type CommittedFixture } from './fixture';
import { captureFingerprint, consumeSnapshot, validateSnapshot, type Checkpoint, type PreservationScope, type PreservationSnapshot } from './preservation';
type Pending = {
    slot: Slot;
    checkpoint: Checkpoint;
    intent: JournalRecord;
    receiptAt: string;
    extras: Partial<PreservationScope>;
};
/** Explicit finite orchestration, never a live CLI. Constructing or importing
 * this package does not make a request, allocate a UUID, open a window or arm.
 * Every action is separately invoked, source/evidence checked, serialized and
 * root-reserved before its one permitted mutation. Human actions stay human.
 */
export function createW2Operator(plan: W2Plan, options: {
    mode: TransportMode;
    fetch: typeof fetch;
    credentials: {
        render: string;
        management: string;
        github: string;
        serviceRole: string;
    };
    preimage: Preimage;
    journal: Journal;
    localMockSource?: CollectorOptions['localMockSource'];
}) {
    assertOwnedJournal(options.journal, plan, options.mode === 'LOCAL_MOCK' ? 'LOCAL_MOCK' : 'PRODUCTION');
    options = { ...options, credentials: { ...options.credentials }, preimage: structuredClone(options.preimage), localMockSource: options.localMockSource ? { ...options.localMockSource } : undefined };
    const transport = createFiniteTransport(plan, options), control = controls(plan, options.preimage), privateAuthorization = 'Bearer ' + options.credentials.serviceRole;
    let busy = false, currentScope: Scope | null = null, lastSnapshot: PreservationSnapshot | null = null, pending: Pending | null = null, baselineInitialized = false;
    const interrupted: Pending[] = [], unresolved = new Set<Slot>();
    const checks = (before: unknown, current: unknown, checkpoint: Checkpoint, intent: JournalRecord, end: string, extras: Partial<PreservationScope> = {}) => { const result = consumeSnapshot(before, current, checkpoint, { rootId: FIXED.root, windowId: intent.windowId, teamId: FIXED.team, accountId: FIXED.account, planSHA256: plan.planSHA256, expectedSHA: plan.expectedSHA, operationStartedAt: intent.at, operationFinishedAt: end, clockSkewSeconds: plan.clockSkewSeconds, clockPolicyApproved: plan.clockPolicyApproved, ...extras }); need(result.status === 'PASS', 'preservation_' + result.violations.join('_')); return result; };
    const proof = (r: Readiness, s: Slot, sc = currentScope) => consumeReadiness(r, plan, s, sc, transport);
    const accepted = (s: Slot) => { const r = options.journal.read(s, 'receipt'); need(r?.status === 'KNOWN_ACCEPTED', 'accepted_predecessor_' + s); return r; };
    const terminal = (s: Slot) => { accepted(s); need(options.journal.read(s, 'terminal')?.status === 'TERMINAL_SUCCEEDED', 'terminal_predecessor_' + s); };
    const exact = (r: Readiness, s: Slot, sc = currentScope) => { need(lastSnapshot && baselineInitialized && !pending, 'settle_previous_checkpoint'); const p = proof(r, s, sc); const current = validateSnapshot(p.baseline), intent = { at: lastSnapshot.capturedAt, windowId: sc?.windowId ?? null } as JournalRecord; checks(lastSnapshot, current, { kind: 'exact' }, intent, current.capturedAt); return p; };
    function graph(handle: Capability, p: ReturnType<typeof proof>) {
        const s = handle.slot, web = p.services.find(x => x.id === WEB)!, worker = p.services.find(x => x.id === FIXED.worker)!;
        if (s !== 'db/prepare' && s !== 'db/stop')
            accepted('db/prepare');
        if (s === 'controls/web-deploy-warm')
            accepted('controls/env-warm');
        if (s === 'controls/worker-suspend') {
            const deploy = accepted('controls/web-deploy-warm');
            need(deploy.providerId === web.live.id && deploy.providerId === web.newest.id && web.teamEnabled === 'true' && p.authConfigSHA256 === control.fingerprints.authWarm && worker.instances.length === 1 && worker.instances[0].ready === true && worker.instances[0].status === 'RUNNING', 'owned_warm_and_current_instance');
            accepted('controls/auth-add');
        }
        if (s === 'db/arm')
            accepted('controls/worker-suspend');
        if (s === 'db/arm' || s.startsWith('render/')) {
            const d = accepted('controls/web-deploy-warm');
            need(d.providerId === web.live.id && d.providerId === web.newest.id, 'same_owned_warm_build');
        }
        if (s.startsWith('render/access/')) {
            terminal('db/grant-cas');
            const index = PARTICIPANTS.indexOf(s.slice('render/access/'.length) as typeof PARTICIPANTS[number]);
            need(index >= 0, 'existing_participant');
            if (index)
                terminal(slot('render/access/' + PARTICIPANTS[index - 1]));
            need(web.environmentSHA256 === control.fingerprints.webWarm && p.authConfigSHA256 === control.fingerprints.authWarm, 'access_actual_warm');
        }
        if (s === 'render/team_aggregate') {
            for (const id of PARTICIPANTS)
                terminal(slot('render/access/' + id));
            need((p.state.cohort as {
                status: string;
            }[]).every(x => x.status === 'completed'), 'privacy_threshold_three');
        }
        if (s === 'render/team_ai_report')
            terminal('render/team_aggregate');
        if (s === 'controls/env-restore' || s === 'controls/auth-restore' || s === 'controls/web-deploy-restore' || s === 'controls/worker-resume') {
            accepted('db/stop');
            need(p.state.publicEligible === 0 && p.state.teamEligible === 0 && p.state.leases === 0, 'safe_target_containment');
        }
        if (s === 'controls/env-restore')
            accepted('controls/env-warm');
        if (s === 'controls/auth-restore')
            accepted('controls/auth-add');
        if (s === 'controls/web-deploy-restore') {
            accepted('controls/env-restore');
            accepted('controls/auth-restore');
            need(web.environmentSHA256 === control.fingerprints.webBefore && p.authConfigSHA256 === control.fingerprints.authBefore, 'exact_preimage_before_restore_deploy');
        }
        if (s === 'controls/worker-resume') {
            terminal('db/free-cas');
            const deploy = accepted('controls/web-deploy-restore');
            need(deploy.providerId === web.live.id && deploy.providerId === web.newest.id && web.environmentSHA256 === control.fingerprints.webBefore && p.authConfigSHA256 === control.fingerprints.authBefore, 'owned_restored_runtime');
        }
    }
    async function serialized<T>(fn: () => Promise<T>): Promise<T> { need(!busy, 'serialized_action_busy'); busy = true; try {
        return await fn();
    }
    finally {
        busy = false;
    } }
    async function execute(handle: Capability, r: Readiness, checkpoint: Checkpoint, extras: Partial<PreservationScope> = {}) { return serialized(async () => { need(options.mode !== 'READ_ONLY', 'read_only_operator'); const stopping = handle.slot === 'db/stop', sc = handle.windowId ? scope(plan, handle.windowId) : null; const p = stopping ? proof(r, handle.slot, sc) : exact(r, handle.slot, handle.slot === 'db/prepare' ? null : sc); graph(handle, p); const instanceId = handle.slot === 'controls/worker-suspend' ? String(p.services.find(x => x.id === FIXED.worker)!.instances[0].id) : undefined; if (stopping && pending) {
        interrupted.push(pending);
        pending = null;
    } const intent = options.journal.reserve(handle.slot, sc, handle.requestSHA256, instanceId); if (handle.slot === 'db/prepare')
        currentScope = sc; try {
        const receipt = await transport.execute(handle, intent, r);
        if (receipt.providerId)
            for (const s of [...PARTICIPANTS.map(id => slot('render/access/' + id)), 'render/team_aggregate', 'render/team_ai_report', 'controls/web-deploy-warm', 'controls/web-deploy-restore'] as Slot[]) {
                if (s !== handle.slot)
                    need(options.journal.read(s, 'receipt')?.providerId !== receipt.providerId, 'provider_id_reused');
            }
        options.journal.receipt(handle.slot, 'KNOWN_ACCEPTED', receipt.responseSHA256, receipt.providerId ?? undefined, receipt.httpStatus ?? undefined);
        pending = { slot: handle.slot, checkpoint, intent, receiptAt: new Date().toISOString(), extras };
        return Object.freeze({ slot: handle.slot, status: 'KNOWN_ACCEPTED', providerId: receipt.providerId, evidenceSHA256: receipt.responseSHA256, noRetryAuthorized: true });
    }
    catch {
        unresolved.add(handle.slot);
        try {
            options.journal.receipt(handle.slot, 'UNKNOWN_SPENT_STOP', digest({ unknown: true, slot: handle.slot }));
        }
        catch { /* Existing/ambiguous receipt remains spent. */ }
        throw Error('w2_operator_unknown_action_spent_STOP');
    } }); }
    return Object.freeze({
        source: Object.freeze({ expectedSHA: plan.expectedSHA, treeSHA: plan.treeSHA, planSHA256: plan.planSHA256, liveExecutionAuthorized: plan.authorization === 'EXPLICIT_OWNER_W2_EXECUTION', realCallsByConstruction: 0 }),
        get scope() { return currentScope; },
        async observe(drains?: readonly [
            Readiness,
            Readiness
        ]) { return collectReadiness(plan, currentScope, transport, { preimage: options.preimage, mode: options.mode === 'LOCAL_MOCK' ? 'LOCAL_MOCK' : 'PRODUCTION', localMockSource: options.localMockSource, journal: options.journal, drains }); },
        initialize(r: Readiness) { need(!busy, 'serialized_action_busy'); need(!baselineInitialized && !currentScope && !pending, 'baseline_once'); const p = proof(r, 'db/prepare', null); lastSnapshot = validateSnapshot(p.baseline); need(captureFingerprint(lastSnapshot) === plan.finalBaselineSHA256, 'owner_post_human_baseline'); baselineInitialized = true; return readinessSummary(r); },
        prepare(candidateWindowId: string, r: Readiness) { need(currentScope === null, 'one_window_only'); const sc = scope(plan, candidateWindowId); return execute(databaseAction(plan, sc, 'prepare'), r, { kind: 'prepare' }); },
        control(kind: Parameters<typeof control.build>[0], r: Readiness) { need(currentScope, 'prepared_window_required'); return execute(control.build(kind, currentScope), r, { kind: 'exact' }); },
        arm(r: Readiness) { need(currentScope, 'prepared_window_required'); return execute(databaseAction(plan, currentScope, 'arm'), r, { kind: 'arm' }); },
        stop(r: Readiness) { need(currentScope, 'existing_window_required'); return execute(databaseAction(plan, currentScope, 'stop'), r, { kind: 'stop' }); },
        access(participantId: string, r: Readiness) { need(currentScope, 'active_window_required'); return execute(accessJob(plan, currentScope, participantId), r, { kind: 'access', participantId }); },
        worker(kind: 'team_aggregate' | 'team_ai_report', r: Readiness) { need(currentScope, 'active_window_required'); const p = proof(r, slot('render/' + kind)), window = p.state.window as {
            source_fingerprint: string;
            report_id: string | null;
        }; const targets = (p.state.targetJobs as {
            id: string;
            kind: string;
            team: string;
            source: string;
            window: string;
            root: string;
            status: string;
            attempts: number;
            hasLease: boolean;
            createdAt: string;
        }[]).filter(x => x.kind === kind && x.window === currentScope!.windowId); need(targets.length === 1 && targets[0].root === FIXED.root && targets[0].team === FIXED.team && targets[0].status === 'queued' && targets[0].attempts === 0 && !targets[0].hasLease && p.state.publicEligible === 0 && p.state.teamEligible === 1 && p.state.leases === 0, 'exact_unclaimed_target_only'); const last = p.drains[1]; need(last && Date.parse(targets[0].createdAt) >= Date.parse(last.checkedAt), 'actual_pre_enqueue_drain'); return execute(workerJob(plan, currentScope, kind, targets[0].source, kind === 'team_ai_report' ? window.report_id : null), r, { kind: kind === 'team_aggregate' ? 'aggregate' : 'report' }, { expectedJobId: targets[0].id, expectedSourceFingerprint: targets[0].source, expectedReportId: kind === 'team_ai_report' ? window.report_id ?? undefined : undefined }); },
        terminalize(kind: 'aggregate' | 'report', targetJobId: string, r: Readiness) { need(currentScope, 'existing_window_required'); const p = proof(r, slot('db/terminalize-' + kind)), jobs = p.state.targetJobs as {
            id: string;
            kind: string;
            window: string;
            status: string;
            attempts: number;
            hasLease: boolean;
        }[]; const j = jobs.find(x => x.id === targetJobId); need(j && j.window === currentScope.windowId && j.kind === 'team_' + (kind === 'aggregate' ? 'aggregate' : 'ai_report') && !j.hasLease && ['queued', 'failed'].includes(j.status) && j.attempts === 0, 'finite_unclaimed_terminalizer'); return execute(databaseAction(plan, currentScope, kind === 'aggregate' ? 'terminalize-aggregate' : 'terminalize-report', targetJobId), r, { kind: kind === 'aggregate' ? 'terminalize-aggregate' : 'terminalize-report' }, { expectedJobId: targetJobId }); },
        /** Fresh post-effect capture is mandatory before another serialized action. */
        settle(r: Readiness) { need(!busy, 'serialized_action_busy'); need(pending && lastSnapshot, 'pending_checkpoint_required'); const p = observedReadiness(r, plan, currentScope, transport); let operationEnd = pending.receiptAt; if (pending.slot.startsWith('render/')) {
            const receipt = accepted(pending.slot), service = p.services.find(s => s.id === (pending!.slot.startsWith('render/access/') ? WEB : FIXED.worker))!, jobs = service.jobs.filter(j => j.id === receipt.providerId);
            need(jobs.length === 1 && jobs[0].status === 'succeeded' && typeof jobs[0].startedAt === 'string' && typeof jobs[0].finishedAt === 'string' && Date.parse(jobs[0].startedAt) >= Date.parse(pending.intent.at) && Date.parse(jobs[0].finishedAt) <= Date.parse(r.checkedAt), 'actual_owned_job_terminal');
            operationEnd = jobs[0].finishedAt as string;
        } const result = checks(lastSnapshot, p.baseline, pending.checkpoint, pending.intent, operationEnd, pending.extras); lastSnapshot = validateSnapshot(p.baseline); options.journal.terminal(pending.slot, captureFingerprint(lastSnapshot)); pending = null; return result; },
        closure(r: Readiness) { need(!busy, 'serialized_action_busy'); need(currentScope && lastSnapshot && baselineInitialized && !pending && interrupted.length === 0 && unresolved.size === 0, 'no_unresolved_closure'); options.journal.assertSettled(); terminal('db/stop'); terminal('db/free-cas'); terminal('controls/worker-resume'); const p = observedReadiness(r, plan, currentScope, transport), web = p.services.find(s => s.id === WEB)!, worker = p.services.find(s => s.id === FIXED.worker)!; need(web.environmentSHA256 === control.fingerprints.webBefore && worker.environmentSHA256 === control.fingerprints.workerBefore && p.authConfigSHA256 === control.fingerprints.authBefore, 'exact_closure_preimages'); need(p.state.publicEligible === 0 && p.state.teamEligible === 0 && p.state.leases === 0 && p.services.every(s => s.jobs.every(j => ['succeeded', 'failed', 'canceled', 'cancelled'].includes(String(j.status)))), 'closure_queues_and_oneoffs'); need(worker.suspended === 'not_suspended' && worker.instances.length === 1 && worker.instances[0].status === 'RUNNING' && worker.instances[0].ready === true && worker.instances[0].id !== p.stop?.instanceId && p.idle && p.idle.instanceId === worker.instances[0].id && Date.now() - Date.parse(p.idle.observedAt) <= 60000, 'actual_worker_resumed_idle'); const effects = validateSnapshot(p.baseline).tables['private.controlled_team_effects'].rows.map(x => x.facts).filter((x): x is Record<string, unknown> => !!x && x.run_id === FIXED.root); for (const kind of ['reauth_link', 'access_email'])
            need(effects.filter(x => x.effect === kind).length <= 3, 'lifetime_access_caps'); for (const kind of ['model_get', 'synthesis', 'synthesis_repair', 'main_report', 'report_repair', 'pdf'])
            need(effects.filter(x => x.effect === kind).length <= 1, 'original_lifetime_caps'); need(effects.every(x => x.status !== 'reserved'), 'no_unsettled_effects'); const snapshot = validateSnapshot(p.baseline), intent = { at: lastSnapshot.capturedAt, windowId: currentScope.windowId } as JournalRecord, result = checks(lastSnapshot, snapshot, { kind: 'closure' }, intent, snapshot.databaseClock); lastSnapshot = snapshot; const completed = [...PARTICIPANTS.map(id => slot('render/access/' + id)), ...PARTICIPANTS.map(id => slot('providers/' + id + '/verify')), ...PARTICIPANTS.map(id => slot('db/answers/' + id)), 'render/team_aggregate', 'db/request-report', 'render/team_ai_report', 'db/pdf'].every(s => options.journal.read(s as Slot, 'terminal')?.status === 'TERMINAL_SUCCEEDED'); return Object.freeze({ status: completed ? 'W2_SMOKE_CLOSED_PRESERVED_AWAITING_OWNER_REVIEW' : 'W2_CONTAINED_PRESERVED_GATES_OFF_INCOMPLETE', evidenceSHA256: result.evidenceSHA256, captureSHA256: captureFingerprint(snapshot), expectedSHA: plan.expectedSHA, productionBilling: 'OFF', requiresOwnerReportPDFReview: true }); },
        status() { return Object.freeze({ windowId: currentScope?.windowId ?? null, pending: pending?.slot ?? null, interrupted: interrupted.map(x => x.slot), unresolved: [...unresolved], automaticRetryAvailable: false }); },
        reservePersonalVerification(participantId: string, r: Readiness) { need(!busy, 'serialized_action_busy'); need(currentScope && (PARTICIPANTS as readonly string[]).includes(participantId), 'existing_personal_scope'); const s = slot('providers/' + participantId + '/verify'), p = exact(r, s), w = p.state.window as {
            personal_deadline_at: string;
        }; for (const id of PARTICIPANTS)
            terminal(slot('render/access/' + id)); need(Date.now() < Date.parse(w.personal_deadline_at), 'personal_deadline'); const intent = options.journal.reserve(s, currentScope, digest({ operation: 'personal_current_consent_verification', root: FIXED.root, window: currentScope.windowId, participantId, marketing: false })); pending = { slot: s, checkpoint: { kind: 'verify-finalize', participantId }, intent, receiptAt: intent.at, extras: {} }; return Object.freeze({ participantId, requiresPersonalConsent: true, marketing: false, agentAuthRequests: 0, noRetryAuthorized: true }); },
        reserveAnswers(participantId: string, r: Readiness, fixture: CommittedFixture) { need(!busy, 'serialized_action_busy'); need(currentScope && (PARTICIPANTS as readonly string[]).includes(participantId), 'existing_answer_scope'); terminal(slot('providers/' + participantId + '/verify')); need(fixture.mode === (options.mode === 'LOCAL_MOCK' ? 'LOCAL_MOCK' : 'PRODUCTION') && fixture.assignmentCommitmentSHA256 === plan.fixtureCommitmentSHA256, 'owned_private_fixture_binding'); const expected = fixtureAnswerExpectation(fixture, participantId, privateAuthorization), s = slot('db/answers/' + participantId), p = exact(r, s), responses = validateSnapshot(p.baseline).tables['private.team_responses'].rows.filter(x => x.facts?.participant_id === participantId); need(responses.length === 1 && responses[0].facts?.revision === 0 && responses[0].facts?.completed_at === null, 'actual_unsubmitted_response_revision'); const revision = 1, intent = options.journal.reserve(s, currentScope, digest({ operation: 'one_same_participant_fixture_submission', participantId, fixtureCommitmentSHA256: expected.fixtureCommitmentSHA256 })); pending = { slot: s, checkpoint: { kind: 'answers', participantId }, intent, receiptAt: intent.at, extras: { expectedAnswersHMAC: expected.answersHMAC, expectedRevision: revision, expectedAnswersCount: expected.count, submitAnswers: true, expectedFixtureCommitmentSHA256: expected.fixtureCommitmentSHA256 } }; return Object.freeze({ participantId, normalParticipantUIRequired: true, agentHTTPRequests: 0, noRawAnswersOrMappingExported: true }); },
        reserveReportRequest(r: Readiness) { need(!busy, 'serialized_action_busy'); need(currentScope, 'active_window_required'); terminal('render/team_aggregate'); const s = 'db/request-report' as const; exact(r, s); const intent = options.journal.reserve(s, currentScope, digest({ operation: 'normal_same_team_report_request', team: FIXED.team })); pending = { slot: s, checkpoint: { kind: 'request-report' }, intent, receiptAt: intent.at, extras: {} }; return Object.freeze({ teamId: FIXED.team, normalOrganizerUIRequired: true, agentHTTPRequests: 0 }); },
        reservePDF(r: Readiness) { need(!busy, 'serialized_action_busy'); need(currentScope, 'same_report_pdf'); terminal('render/team_ai_report'); const s = 'db/pdf' as const, p = exact(r, s), reportId = (p.state.window as {
            report_id: string;
        }).report_id; need(typeof reportId === 'string', 'existing_completed_report'); const intent = options.journal.reserve(s, currentScope, digest({ operation: 'one_completed_team_pdf', team: FIXED.team, reportId })); pending = { slot: s, checkpoint: { kind: 'pdf' }, intent, receiptAt: intent.at, extras: { expectedReportId: reportId } }; return Object.freeze({ teamId: FIXED.team, normalOrganizerUIRequired: true, maximumPDF: 1, agentHTTPRequests: 0 }); },
        settleHuman(r: Readiness) { need(!busy, 'serialized_action_busy'); need(pending && lastSnapshot && (pending.slot.startsWith('providers/') || pending.slot.startsWith('db/answers/') || pending.slot === 'db/pdf' || pending.slot === 'db/request-report'), 'pending_human_action'); const p = observedReadiness(r, plan, currentScope, transport), snapshot = validateSnapshot(p.baseline); if (pending.slot.startsWith('db/answers/')) {
            const beforeKeys = new Set(lastSnapshot.tables['private.team_jobs'].rows.map(x => x.key)), newJobs = snapshot.tables['private.team_jobs'].rows.filter(x => !beforeKeys.has(x.key));
            if (newJobs.length) {
                need(newJobs.length === 1 && newJobs[0].facts?.kind === 'team_aggregate' && newJobs[0].facts?.controlled_run_id === FIXED.root && newJobs[0].facts?.controlled_window_id === currentScope?.windowId, 'actual_third_submission_aggregate');
                pending.extras = { ...pending.extras, expectedJobId: String(newJobs[0].facts.id), expectedSourceFingerprint: String(newJobs[0].facts.source_fingerprint) };
            }
        } if (pending.slot === 'db/request-report') {
            const w = p.state.window as {
                report_id: string;
            }, targets = (p.state.targetJobs as {
                id: string;
                kind: string;
                window: string;
                source: string;
            }[]).filter(j => j.kind === 'team_ai_report' && j.window === currentScope?.windowId);
            need(w.report_id && targets.length === 1, 'actual_requested_report');
            pending.extras = { ...pending.extras, expectedReportId: w.report_id, expectedJobId: targets[0].id, expectedSourceFingerprint: targets[0].source };
        } const result = checks(lastSnapshot, snapshot, pending.checkpoint, pending.intent, snapshot.databaseClock, pending.extras); options.journal.receipt(pending.slot, 'KNOWN_ACCEPTED', result.evidenceSHA256); options.journal.terminal(pending.slot, captureFingerprint(snapshot)); lastSnapshot = snapshot; pending = null; return result; },
        reserveManualCAS(direction: 'advanced' | 'free', r: Readiness) { need(!busy, 'serialized_action_busy'); need(currentScope, 'existing_window_required'); const s = slot(direction === 'advanced' ? 'db/grant-cas' : 'db/free-cas'), p = exact(r, s), active = (p.state.subscriptions as {
            id: string;
            plan: string;
            status: string;
            source: string;
        }[]).filter(x => x.status === 'active'); need(active.length === 1 && active[0].plan === (direction === 'advanced' ? 'free' : 'advanced') && (direction !== 'advanced' || active[0].id === FIXED.freeSubscription), 'exact_manual_CAS_preimage'); if (direction === 'advanced')
            accepted('db/arm');
        else
            accepted('db/stop'); const request = { accountId: FIXED.account, oldPlan: active[0].plan, targetPlan: direction, expectedSubscriptionId: active[0].id, administratorUserId: 'dea5f776-1923-4e8d-9042-d3ffbb1d8833' }; const intent = options.journal.reserve(s, currentScope, digest(request)); pending = { slot: s, checkpoint: { kind: direction === 'advanced' ? 'grant-advanced' : 'restore-free' }, intent, receiptAt: new Date().toISOString(), extras: { expectedSubscriptionId: active[0].id } }; return Object.freeze({ ...request, requiresRealAdministratorAction: true, agentHTTPRequests: 0, noRetryAuthorized: true }); },
        settleManualCAS(r: Readiness) { need(!busy, 'serialized_action_busy'); need(pending && lastSnapshot && ['db/grant-cas', 'db/free-cas'].includes(pending.slot), 'pending_manual_CAS'); const p = proof(r, pending.slot), changes = p.state.planChanges as {
            id: string;
            actor: string;
            oldPlan: string;
            newPlan: string;
            subscription: string;
            createdAt: string;
        }[]; const matches = changes.filter(x => x.actor === 'dea5f776-1923-4e8d-9042-d3ffbb1d8833' && x.oldPlan === (pending!.slot === 'db/grant-cas' ? 'free' : 'advanced') && x.newPlan === (pending!.slot === 'db/grant-cas' ? 'advanced' : 'free') && Date.parse(x.createdAt) >= Date.parse(pending!.intent.at)); need(matches.length === 1, 'actual_single_CAS_audit'); const result = checks(lastSnapshot, p.baseline, pending.checkpoint, pending.intent, matches[0].createdAt, { ...pending.extras, expectedSubscriptionId: matches[0].subscription }); options.journal.receipt(pending.slot, 'KNOWN_ACCEPTED', result.evidenceSHA256, matches[0].subscription); options.journal.terminal(pending.slot, captureFingerprint(p.baseline)); lastSnapshot = validateSnapshot(p.baseline); pending = null; return result; }
    });
}
// The factory is exported for maintainable tests/integration, with no invocation.
export { openRootJournal };
