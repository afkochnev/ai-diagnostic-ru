import { z } from "zod";
import {
  canonicalJson, contextHash, EvidenceError, parseJson, parsePlan, parseReview,
  pointer, ROLES, SECTIONS, sha256,
  type Artifact, type Plan, type Review, type Role, type Subject,
} from "./contract";

export type Objects = ReadonlyMap<string, Uint8Array>;
export type CaseDecision = {
  case_id: Plan["cases"][number]["case_id"];
  decision: "REVIEW_PASS" | "HOLD";
  evidence_state: "complete" | "rejected" | "incomplete";
  reasons: string[];
};
export type Decision = {
  decision: "REVIEW_PASS" | "HOLD";
  policy: string;
  context_sha256: string;
  cases: CaseDecision[];
};
function object(bytes: Uint8Array): Record<string, unknown> {
  const parsed = parseJson(bytes);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new EvidenceError("OBJECT_REQUIRED");
  return parsed as Record<string, unknown>;
}
function get(objects: Objects, ref: Artifact): Uint8Array {
  const bytes = objects.get(ref.sha256);
  if (!bytes) throw new EvidenceError("ARTIFACT_MISSING");
  if (sha256(bytes) !== ref.sha256) throw new EvidenceError("ARTIFACT_HASH_MISMATCH");
  return bytes;
}
export function subjectFor(plan: Plan, caseId: Plan["cases"][number]["case_id"], rawBytes: Uint8Array): Subject {
  const entry = plan.cases.find(c => c.case_id === caseId);
  if (!entry) throw new EvidenceError("CASE_NOT_REGISTERED");
  const raw = object(rawBytes);
  if (typeof raw.output_text !== "string") throw new EvidenceError("OUTPUT_TEXT_MISSING");
  return {
    context_sha256: contextHash(plan), case_id: caseId, raw_sha256: sha256(rawBytes),
    output_sha256: sha256(raw.output_text), input_sha256: entry.input.sha256,
    prompt_sha256: plan.candidate.prompt_sha256, schema_sha256: plan.candidate.schema_sha256,
    candidate_source_commit: plan.candidate.source_commit, model: plan.candidate.model,
  };
}
const line = z.string().trim().min(1);
const lines = (min: number, max: number) => z.array(line).min(min).max(max);
// Fixed local schema/rubric. The bundled schema is hashed, never interpreted or fetched.
const reportSchema = z.strictObject({
  summary: line, main_diagnosis: line, manageability_index_text: line,
  strengths: lines(3, 4), key_problem_zones: lines(3, 4), growth_constraint: line,
  implementation_risks: lines(4, 5), first_actions: lines(4, 5),
  plan_30_days: lines(5, 7), plan_60_days: lines(5, 7), plan_90_days: lines(5, 7), next_step: line,
});
function validateRaw(plan: Plan, caseId: string, raw: Record<string, unknown>, input: unknown): void {
  if (raw.case_id !== caseId || canonicalJson(raw.input) !== canonicalJson(input))
    throw new EvidenceError("RAW_INPUT_MISMATCH");
  // Existing provider receipts use insertion-order JSON.stringify(input), not file-byte hashing.
  if (raw.input_sha256 !== sha256(JSON.stringify(raw.input))) throw new EvidenceError("RAW_INPUT_DIGEST_MISMATCH");
  if (raw.candidate_source_commit !== plan.candidate.source_commit || raw.prompt_sha256 !== plan.candidate.prompt_sha256
    || raw.schema_sha256 !== plan.candidate.schema_sha256) throw new EvidenceError("RAW_CANDIDATE_MISMATCH");
  if (raw.model_requested !== plan.candidate.model || raw.model_returned !== plan.candidate.model)
    throw new EvidenceError("RAW_MODEL_MISMATCH");
  if (raw.response_status !== "completed" || raw.request_count !== 1 || raw.max_retries !== 0 || raw.store !== false
    || raw.synthetic_only !== true) throw new EvidenceError("RAW_RECEIPT_INVALID");
  if (typeof raw.host_runtime_commit !== "string" || !/^[a-f0-9]{40}$/.test(raw.host_runtime_commit)
    || typeof raw.harness_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(raw.harness_sha256)
    || typeof raw.mounted_prompt_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(raw.mounted_prompt_sha256))
    throw new EvidenceError("RAW_PROVENANCE_INCOMPLETE");
}
function validateReport(raw: Record<string, unknown>): unknown {
  if (typeof raw.output_text !== "string") throw new EvidenceError("OUTPUT_TEXT_MISSING");
  const report: unknown = parseJson(Buffer.from(raw.output_text));
  if (!reportSchema.safeParse(report).success) throw new EvidenceError("REPORT_SCHEMA_OR_COUNTS_INVALID");
  for (const key of ["main_diagnosis", "manageability_index_text", "growth_constraint"])
    if (String((report as Record<string, unknown>)[key]).split(/\n\s*\n/).filter(s => s.trim()).length < 2)
      throw new EvidenceError("REPORT_PARAGRAPHS_INVALID");
  const nextParagraphs = String((report as Record<string, unknown>).next_step).split(/\n\s*\n/).filter(s => s.trim()).length;
  if (nextParagraphs > 2) throw new EvidenceError("REPORT_PARAGRAPHS_INVALID");
  return report;
}
function checkFinding(review: Review, report: unknown, input: unknown): void {
  for (const finding of review.findings) {
    const expectedPrefix = `/${finding.section}`;
    if (finding.report_pointer !== expectedPrefix && !finding.report_pointer.startsWith(`${expectedPrefix}/`))
      throw new EvidenceError("FINDING_SECTION_MISMATCH");
    const target = pointer(report, finding.report_pointer);
    if (typeof target !== "string" || !target.includes(finding.quote)) throw new EvidenceError("FINDING_QUOTE_MISMATCH");
    for (const inputPointer of finding.input_pointers) pointer(input, inputPointer);
  }
}
function legacy(ref: Plan["cases"][number]["reviews"][number], bytes: Uint8Array, rawHash: string, promptHash: string): boolean {
  const review = object(bytes);
  const read = (path: string) => { try { return pointer(review, path); } catch { return undefined; } };
  let status: unknown;
  let coverage: unknown;
  let rawBinding: unknown;
  let promptBinding: unknown;
  if (ref.format === "legacy-facts/v1" && ref.role === "facts") {
    status = read("/verdict"); coverage = read("/section_reviews");
    rawBinding = read("/raw_output_sha256") ?? read("/source_file_sha256");
    promptBinding = read("/provenance/prompt_sha256") ?? read("/prompt_sha256");
  } else if (ref.format === "legacy-depth/v1" && ref.role === "depth") {
    status = read("/overall_verdict"); coverage = read("/section_reviews");
    rawBinding = read("/source/file_sha256"); promptBinding = read("/source/prompt_sha256");
  } else if (ref.format === "legacy-boundary/v1" && ref.role === "boundary") {
    status = read("/verdict"); coverage = read("/sections_reviewed");
    rawBinding = read("/provider_record_sha256"); promptBinding = read("/prompt_sha256");
  } else throw new EvidenceError("LEGACY_FORMAT_ROLE_MISMATCH");
  if (rawBinding !== rawHash || promptBinding !== promptHash) throw new EvidenceError("LEGACY_SUBJECT_MISMATCH");
  const sections = Array.isArray(coverage) ? coverage.map(s => typeof s === "string" ? s : (s as { section?: unknown })?.section) : [];
  if (sections.length !== 12 || new Set(sections).size !== 12 || !SECTIONS.every(s => sections.includes(s)))
    throw new EvidenceError("LEGACY_COVERAGE_INCOMPLETE");
  if (!["PASS", "FAIL", "HOLD"].includes(String(status))) throw new EvidenceError("LEGACY_VERDICT_INVALID");
  // Legacy PASS never meets the native protocol. Preserve a negative decision without backfilling identities or section rationales.
  return status === "FAIL";
}
function history(role: Role, reviews: Map<string, Review>, head: string | null): void {
  const assigned = [...reviews].filter(([, r]) => r.role === role);
  if (!head || !reviews.has(head) || reviews.get(head)!.role !== role) throw new EvidenceError("REVIEW_HEAD_MISSING");
  const visited = new Set<string>();
  let cursor: string | null = head;
  let revision: number | undefined;
  let identity: string | undefined;
  while (cursor) {
    if (visited.has(cursor)) throw new EvidenceError("REVIEW_HISTORY_CYCLE");
    visited.add(cursor);
    const review = reviews.get(cursor);
    if (!review || review.role !== role) throw new EvidenceError("REVIEW_HISTORY_INCOMPLETE");
    if (identity !== undefined && review.review_id !== identity) throw new EvidenceError("REVIEW_HISTORY_ID_MISMATCH");
    identity = review.review_id;
    if (revision !== undefined && review.revision !== revision - 1) throw new EvidenceError("REVIEW_HISTORY_REVISION_INVALID");
    revision = review.revision;
    cursor = review.supersedes;
    if (!cursor && review.revision !== 1) throw new EvidenceError("REVIEW_HISTORY_INCOMPLETE");
  }
  if (visited.size !== assigned.length) throw new EvidenceError("REVIEW_HISTORY_FORK_OR_STALE_HEAD");
}

export function evaluate(inputPlan: Plan, objects: Objects): Decision {
  const plan = parsePlan(inputPlan);
  get(objects, plan.prompt); get(objects, plan.schema);
  const cases: CaseDecision[] = [];
  const usedIds = new Map<string, string>();
  for (const entry of plan.cases) {
    const reasons = new Set<string>();
    let rejected = false;
    const attempt = (fn: () => void) => {
      try { fn(); } catch (e) { reasons.add(e instanceof EvidenceError ? e.code : "EVIDENCE_INVALID"); }
    };
    if (!plan.review_inventory_complete) reasons.add("REVIEW_INVENTORY_UNATTESTED");
    let input: unknown;
    let raw: Record<string, unknown> | undefined;
    let report: unknown;
    let subject: Subject | undefined;
    attempt(() => { input = parseJson(get(objects, entry.input)); });
    if (!entry.raw) reasons.add("RAW_MISSING");
    else attempt(() => {
      const bytes = get(objects, entry.raw!);
      raw = object(bytes);
      subject = subjectFor(plan, entry.case_id, bytes);
      // Validate independently so an old receipt gap cannot hide a registered negative review.
      attempt(() => validateRaw(plan, entry.case_id, raw!, input));
      attempt(() => { report = validateReport(raw!); });
    });
    const reviews = new Map<string, Review>();
    const nativeRoles = new Set<Role>();
    const registered = new Set<string>();
    for (const ref of entry.reviews) attempt(() => {
      if (registered.has(ref.sha256)) throw new EvidenceError("REVIEW_REGISTERED_TWICE");
      registered.add(ref.sha256);
      const bytes = get(objects, ref);
      if (ref.format !== "native/v1") {
        reasons.add("LEGACY_REVIEW_NOT_NATIVE");
        if (legacy(ref, bytes, entry.raw?.sha256 ?? "", plan.candidate.prompt_sha256)) {
          rejected = true; reasons.add("REVIEW_REJECTED");
        }
        return;
      }
      const review = parseReview(parseJson(bytes));
      if (review.role !== ref.role || review.reviewer_id !== plan.reviewers[ref.role])
        throw new EvidenceError("REVIEW_ASSIGNMENT_MISMATCH");
      if (!subject || canonicalJson(review.subject) !== canonicalJson(subject)) throw new EvidenceError("REVIEW_SUBJECT_MISMATCH");
      const identityScope = `${entry.case_id}/${review.role}`;
      const previous = usedIds.get(review.review_id);
      if (previous !== undefined && previous !== identityScope) throw new EvidenceError("REVIEW_ID_REUSED");
      usedIds.set(review.review_id, identityScope);
      reviews.set(ref.sha256, review); nativeRoles.add(review.role);
      if (review.verdict !== "PASS" || review.sections.some(s => s.verdict !== "PASS") || review.findings.length) {
        reasons.add("REVIEW_REJECTED"); rejected = true;
      }
      checkFinding(review, report, input);
    });
    for (const role of ROLES) {
      if (!nativeRoles.has(role)) reasons.add(`REQUIRED_${role.toUpperCase()}_REVIEW_MISSING`);
      else attempt(() => history(role, reviews, entry.review_heads[role]));
    }
    cases.push({
      case_id: entry.case_id, decision: reasons.size ? "HOLD" : "REVIEW_PASS",
      evidence_state: rejected ? "rejected" : reasons.size ? "incomplete" : "complete",
      reasons: [...reasons].sort(),
    });
  }
  return { decision: cases.every(c => c.decision === "REVIEW_PASS") ? "REVIEW_PASS" : "HOLD", policy: plan.policy, context_sha256: contextHash(plan), cases };
}
