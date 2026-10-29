import { afterEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  CASES, POLICY, ROLES, SCHEMA_SHA256, SECTIONS, canonicalJson,
  parseJson, parsePlan, parseReview, pointer, sha256,
  type Artifact, type Plan, type Review, type Role,
} from "../../scripts/individual-report-acceptance/contract";
import { evaluate, subjectFor } from "../../scripts/individual-report-acceptance/evaluate";
import { bundle, loadBundle, loadPlan } from "../../scripts/individual-report-acceptance/evidence";

// Deliberately invented mechanics fixtures. Their recorded reviews are not real
// semantic acceptance and are never used as evidence for a release candidate.
const encode = (value: unknown) => Buffer.from(JSON.stringify(value, null, 2) + "\n");
const schemaBytes = readFileSync(resolve("AI_REPORT_SCHEMA_RU_1_0.json"));
const report = () => ({
  summary: "Это учебный результат. Числа не описывают клиента. Интерпретация требует проверки. Цель остаётся целью. Рекомендуется ограниченная проверка.",
  main_diagnosis: "Рабочая гипотеза подлежит проверке.\n\nПроверить её по учебным данным.",
  manageability_index_text: "Передан учебный индекс.\n\nДостаточность порядка необходимо проверить.",
  strengths: Array.from({ length: 3 }, (_, i) => `Учебный результат ${i + 1} задаёт направление проверки.`),
  key_problem_zones: Array.from({ length: 3 }, (_, i) => `Проверить учебный сигнал ${i + 1}, не предполагая дефект.`),
  growth_constraint: "Ограничение является гипотезой.\n\nЕго наличие и масштаб нужно проверить.",
  implementation_risks: Array.from({ length: 4 }, (_, i) => `Если проверка подтвердит условие ${i + 1} → возможно проявление → возникает риск.`),
  first_actions: Array.from({ length: 4 }, (_, i) => `Проверить область ${i + 1}. Результат — карта; признак выполнения — карта рассмотрена.`),
  plan_30_days: Array.from({ length: 5 }, (_, i) => `Исследовать область ${i + 1}. Ожидаемый результат — исходные данные; контрольная точка — реестр.`),
  plan_60_days: Array.from({ length: 5 }, (_, i) => `Проверить пилот ${i + 1}. Ожидаемый результат — измерения; контрольная точка — обзор.`),
  plan_90_days: Array.from({ length: 5 }, (_, i) => `Оценить пилот ${i + 1}. Ожидаемый результат — вывод; контрольная точка — решение.`),
  next_step: "В ближайшие пять дней начать одну учебную проверку.\n\nРезультат — исходные данные без заранее заданного диагноза.",
});
type Raw = Record<string, unknown> & { output_text: string };
type Fixture = { plan: Plan; objects: Map<string, Uint8Array> };
function put(f: Fixture, path: string, bytes: Uint8Array): Artifact {
  const hash = sha256(bytes); f.objects.set(hash, bytes); return { path, sha256: hash };
}
function fixture(changeRaw?: (raw: Raw, index: number) => void): Fixture {
  const f = { objects: new Map<string, Uint8Array>() } as Fixture;
  const prompt = put(f, "prompt.md", Buffer.from("Учебные инструкции для проверки доказательств.\n"));
  const schema = put(f, "schema.json", schemaBytes);
  f.plan = {
    format: "individual-acceptance-plan/v1", policy: POLICY,
    candidate: { source_commit: "a".repeat(40), prompt_version: "RU-1.4", prompt_sha256: prompt.sha256, schema_sha256: SCHEMA_SHA256, model: "gpt-5.6-sol" },
    prompt, schema, reviewers: { facts: "reviewer-facts", depth: "reviewer-depth", boundary: "reviewer-boundary" },
    review_inventory_complete: true,
    cases: CASES.map((case_id, index) => {
      const input = { company_snapshot: { company_name: `INVENTED-${index}`, main_goals: "Оценить готовность к учебному изменению" }, open_answers: [{ answer: "Показатели ведутся ежемесячно." }] };
      const raw: Raw = {
        case_id, synthetic_only: true, input, input_sha256: sha256(JSON.stringify(input)),
        candidate_source_commit: "a".repeat(40), host_runtime_commit: "b".repeat(40),
        prompt_sha256: prompt.sha256, mounted_prompt_sha256: "c".repeat(64),
        schema_sha256: SCHEMA_SHA256, harness_sha256: "d".repeat(64),
        model_requested: "gpt-5.6-sol", model_returned: "gpt-5.6-sol",
        response_status: "completed", request_count: 1, max_retries: 0, store: false,
        output_text: JSON.stringify(report()),
      };
      changeRaw?.(raw, index);
      return { case_id, input: put(f, `inputs/${case_id}.json`, encode(input)), raw: put(f, `raw/${case_id}.json`, encode(raw)), reviews: [], review_heads: { facts: null, depth: null, boundary: null } };
    }),
  };
  for (let index = 0; index < CASES.length; index++) for (const role of ROLES) {
    const entry = f.plan.cases[index];
    const review: Review = {
      format: "individual-acceptance-review/v1", policy: POLICY, role,
      reviewer_id: f.plan.reviewers[role], review_id: `${entry.case_id}.${role}`, revision: 1, supersedes: null,
      subject: subjectFor(f.plan, entry.case_id, f.objects.get(entry.raw!.sha256)!), verdict: "PASS",
      sections: SECTIONS.map(section => ({ section, verdict: "PASS", rationale: `Учебная роль ${role} проверила раздел ${section}; это fixture, а не реальное заключение.` })), findings: [],
    };
    const ref = { ...put(f, `reviews/${entry.case_id}-${role}.json`, encode(review)), role, format: "native/v1" as const };
    entry.reviews.push(ref); entry.review_heads[role] = ref.sha256;
  }
  return f;
}
function reviewOf(f: Fixture, index: number, role: Role): Review {
  return JSON.parse(Buffer.from(f.objects.get(f.plan.cases[index].review_heads[role]!)!).toString());
}
function changeReview(f: Fixture, index: number, role: Role, change: (review: Review) => void, append = false): string {
  const entry = f.plan.cases[index], oldHash = entry.review_heads[role]!;
  const review = reviewOf(f, index, role); change(review);
  const ref = { ...put(f, `reviews/${entry.case_id}-${role}-${review.revision}.json`, encode(review)), role, format: "native/v1" as const };
  if (!append) entry.reviews = entry.reviews.filter(r => r.sha256 !== oldHash);
  entry.reviews.push(ref); entry.review_heads[role] = ref.sha256; return ref.sha256;
}
function reasons(f: Fixture, index = 0): string[] { return evaluate(f.plan, f.objects).cases[index].reasons; }
const temporary: string[] = [];
function temp(): string { const path = mkdtempSync(join(tmpdir(), "individual-acceptance-test-")); temporary.push(path); return path; }
afterEach(() => { for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true }); });
function allRefs(plan: Plan): Artifact[] {
  return [plan.prompt, plan.schema, ...plan.cases.flatMap(c => [c.input, ...(c.raw ? [c.raw] : []), ...c.reviews])];
}
function savePlan(root: string, plan: Plan): { path: string; pin: string } {
  const bytes = encode(plan), path = join(root, "plan.json"); writeFileSync(path, bytes); return { path, pin: sha256(bytes) };
}
function persist(f: Fixture): { root: string; path: string; pin: string } {
  const root = temp();
  for (const ref of allRefs(f.plan)) { const path = join(root, ref.path); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, f.objects.get(ref.sha256)!); }
  return { root, ...savePlan(root, f.plan) };
}

describe("offline evidence decision, not automatic semantic judgement", () => {
  it("accepts both complete native case reviews while retaining distinct evaluated and mounted prompts", () => {
    const f = fixture(), decision = evaluate(parsePlan(f.plan), f.objects);
    expect(decision.decision).toBe("REVIEW_PASS");
    expect(decision.cases.map(c => c.evidence_state)).toEqual(["complete", "complete"]);
    expect(f.plan.candidate.source_commit).not.toBe("b".repeat(40));
  });
  it("binds exact input-file bytes, independently of the receipt's insertion-order input digest", () => {
    const f = fixture(), entry = f.plan.cases[0], raw = JSON.parse(Buffer.from(f.objects.get(entry.raw!.sha256)!).toString());
    expect(sha256(JSON.stringify(raw.input))).not.toBe(entry.input.sha256);
    expect(reviewOf(f, 0, "facts").subject.input_sha256).toBe(entry.input.sha256);
    expect(evaluate(f.plan, f.objects).decision).toBe("REVIEW_PASS");
  });
  it("holds a missing second raw and never substitutes a passing first case", () => {
    const f = fixture(); f.plan.cases[1].raw = null;
    expect(evaluate(f.plan, f.objects).decision).toBe("HOLD"); expect(reasons(f, 1)).toContain("RAW_MISSING");
  });
  it("requires explicit completeness attestation and all three assigned roles", () => {
    const f = fixture(); f.plan.review_inventory_complete = false;
    f.plan.cases[0].reviews = f.plan.cases[0].reviews.filter(r => r.role !== "boundary");
    expect(reasons(f)).toEqual(expect.arrayContaining(["REVIEW_INVENTORY_UNATTESTED", "REQUIRED_BOUNDARY_REVIEW_MISSING"]));
  });
  it("rejects registering the same review twice instead of treating it as independent coverage", () => {
    const f = fixture(); f.plan.cases[0].reviews.push(f.plan.cases[0].reviews[0]);
    expect(reasons(f)).toContain("REVIEW_REGISTERED_TWICE");
  });
  it("rejects duplicate cases, non-distinct reviewer assignments, and repeated section coverage", () => {
    const f = fixture(); const duplicate = structuredClone(f.plan); duplicate.cases[1].case_id = duplicate.cases[0].case_id;
    expect(() => parsePlan(duplicate)).toThrow("CASE_INVENTORY_INVALID");
    const shared = structuredClone(f.plan); shared.reviewers.boundary = shared.reviewers.facts;
    expect(() => parsePlan(shared)).toThrow("REVIEWER_ASSIGNMENTS_NOT_DISTINCT");
    const review = reviewOf(f, 0, "facts"); review.sections[11] = review.sections[0];
    expect(() => parseReview(review)).toThrow("REVIEW_COVERAGE_INVALID");
  });
  it("blocks a boundary failure even when facts and depth pass", () => {
    const f = fixture(); changeReview(f, 0, "boundary", r => { r.verdict = "FAIL"; r.sections[6].verdict = "FAIL"; });
    const result = evaluate(f.plan, f.objects);
    expect(result.decision).toBe("HOLD"); expect(result.cases[0].evidence_state).toBe("rejected");
  });
  it("does not let an overall PASS hide a failing section or open finding", () => {
    const f = fixture(); changeReview(f, 0, "boundary", r => { r.sections[0].verdict = "HOLD"; });
    expect(reasons(f)).toContain("REVIEW_REJECTED");
    const g = fixture(); changeReview(g, 0, "boundary", r => { r.findings.push({ finding_id: "f1", section: "implementation_risks", report_pointer: "/implementation_risks/2", quote: "возможно проявление", input_pointers: ["/company_snapshot/main_goals"], reason: "Учебное отрицательное заключение с точной привязкой." }); });
    expect(reasons(g)).toEqual(["REVIEW_REJECTED"]);
  });
  it.each(["raw_sha256", "output_sha256", "input_sha256", "prompt_sha256", "schema_sha256", "context_sha256"] as const)("rejects a review attached to a different %s", field => {
    const f = fixture(); changeReview(f, 0, "facts", r => { r.subject[field] = "e".repeat(64); });
    expect(reasons(f)).toContain("REVIEW_SUBJECT_MISMATCH");
  });
  it("rejects swapped case reviews, incorrect reviewer assignments and reused review identities", () => {
    const f = fixture(); changeReview(f, 0, "facts", r => { r.subject.case_id = CASES[1]; });
    expect(reasons(f)).toContain("REVIEW_SUBJECT_MISMATCH");
    const g = fixture(); changeReview(g, 0, "facts", r => { r.reviewer_id = "unassigned-reviewer"; });
    expect(reasons(g)).toContain("REVIEW_ASSIGNMENT_MISMATCH");
    const h = fixture(); changeReview(h, 1, "facts", r => { r.review_id = reviewOf(h, 0, "facts").review_id; });
    expect(reasons(h, 1)).toContain("REVIEW_ID_REUSED");
  });
  it("detects missing and tampered bytes even if a caller supplies an objects map", () => {
    const f = fixture(); f.objects.delete(f.plan.cases[0].input.sha256); expect(reasons(f)).toContain("ARTIFACT_MISSING");
    const g = fixture(); g.objects.set(g.plan.cases[0].raw!.sha256, Buffer.from("{}")); expect(reasons(g)).toContain("ARTIFACT_HASH_MISMATCH");
  });
  it.each([
    ["RAW_CANDIDATE_MISMATCH", (r: Raw) => { r.prompt_sha256 = "e".repeat(64); }],
    ["RAW_MODEL_MISMATCH", (r: Raw) => { r.model_returned = "other-model"; }],
    ["RAW_RECEIPT_INVALID", (r: Raw) => { r.request_count = 2; }],
    ["RAW_PROVENANCE_INCOMPLETE", (r: Raw) => { delete r.mounted_prompt_sha256; }],
    ["RAW_INPUT_DIGEST_MISMATCH", (r: Raw) => { r.input_sha256 = "e".repeat(64); }],
  ] as const)("holds receipt violation %s despite all native PASS reviews", (code, change) => {
    const f = fixture((r, i) => { if (i === 0) change(r); }); expect(reasons(f)).toContain(code);
  });
  it.each(["extra key", "insufficient plan", "missing paragraphs"])("rejects structural defect: %s", defect => {
    const f = fixture((raw, i) => { if (i) return; const r = report();
      if (defect === "extra key") Object.assign(r, { extra: "unapproved" });
      if (defect === "insufficient plan") r.plan_60_days = ["one action"];
      if (defect === "missing paragraphs") r.main_diagnosis = "One paragraph only.";
      raw.output_text = JSON.stringify(r);
    });
    expect(evaluate(f.plan, f.objects).decision).toBe("HOLD");
  });
});

describe("complete review history and anchored findings", () => {
  it("preserves a negative historical review even after a later PASS supersedes it", () => {
    const f = fixture(); const fail = changeReview(f, 0, "boundary", r => { r.verdict = "FAIL"; });
    changeReview(f, 0, "boundary", r => { r.verdict = "PASS"; r.revision = 2; r.supersedes = fail; }, true);
    expect(reasons(f)).toEqual(["REVIEW_REJECTED"]);
  });
  it("refuses an old PASS head when a newer registered FAIL exists", () => {
    const f = fixture(), old = f.plan.cases[0].review_heads.boundary!;
    changeReview(f, 0, "boundary", r => { r.verdict = "FAIL"; r.revision = 2; r.supersedes = old; }, true);
    f.plan.cases[0].review_heads.boundary = old;
    expect(reasons(f)).toEqual(expect.arrayContaining(["REVIEW_REJECTED", "REVIEW_HISTORY_FORK_OR_STALE_HEAD"]));
  });
  it("rejects omitted history, invalid revision sequence and unregistered heads", () => {
    const f = fixture(); changeReview(f, 0, "facts", r => { r.revision = 2; r.supersedes = "e".repeat(64); });
    expect(reasons(f)).toContain("REVIEW_HISTORY_INCOMPLETE");
    const g = fixture(), old = g.plan.cases[0].review_heads.depth!;
    changeReview(g, 0, "depth", r => { r.revision = 3; r.supersedes = old; }, true);
    expect(reasons(g)).toContain("REVIEW_HISTORY_REVISION_INVALID");
    const h = fixture(); h.plan.cases[0].review_heads.facts = "e".repeat(64);
    expect(reasons(h)).toContain("REVIEW_HEAD_MISSING");
  });
  it.each([
    ["FINDING_QUOTE_MISMATCH", "/implementation_risks/2", "quotation absent from report", "/company_snapshot/main_goals"],
    ["FINDING_SECTION_MISMATCH", "/summary", "учебный", "/company_snapshot/main_goals"],
    ["POINTER_NOT_FOUND", "/implementation_risks/2", "возможно проявление", "/absent"],
  ])("holds invalid finding anchor %s", (code, report_pointer, quote, inputPointer) => {
    const f = fixture(); changeReview(f, 0, "boundary", r => { r.verdict = "FAIL"; r.findings.push({ finding_id: "f1", section: "implementation_risks", report_pointer, quote, input_pointers: [inputPointer], reason: "Учебная проверка точного якоря." }); });
    expect(reasons(f)).toContain(code);
  });
  it("never upgrades a legacy PASS into a native independent review", () => {
    const f = fixture(), entry = f.plan.cases[0];
    const legacy = { overall_verdict: "PASS", source: { file_sha256: entry.raw!.sha256, prompt_sha256: f.plan.candidate.prompt_sha256 }, section_reviews: SECTIONS.map(section => ({ section, verdict: "PASS" })) };
    entry.reviews = entry.reviews.filter(r => r.role !== "depth");
    entry.reviews.push({ ...put(f, "reviews/legacy-depth.json", encode(legacy)), role: "depth", format: "legacy-depth/v1" });
    expect(reasons(f)).toEqual(expect.arrayContaining(["LEGACY_REVIEW_NOT_NATIVE", "REQUIRED_DEPTH_REVIEW_MISSING"]));
  });
  it("retains a legacy FAIL even when old provenance is incomplete", () => {
    const f = fixture((raw, index) => { if (!index) delete raw.host_runtime_commit; }), entry = f.plan.cases[0];
    const negative = { overall_verdict: "FAIL", source: { file_sha256: entry.raw!.sha256, prompt_sha256: f.plan.candidate.prompt_sha256 }, section_reviews: SECTIONS.map(section => ({ section, verdict: "FAIL" })) };
    entry.reviews = entry.reviews.filter(r => r.role !== "depth");
    entry.reviews.push({ ...put(f, "reviews/legacy-negative.json", encode(negative)), role: "depth", format: "legacy-depth/v1" });
    const decision = evaluate(f.plan, f.objects).cases[0];
    expect(decision.evidence_state).toBe("rejected");
    expect(decision.reasons).toEqual(expect.arrayContaining(["RAW_PROVENANCE_INCOMPLETE", "REVIEW_REJECTED", "LEGACY_REVIEW_NOT_NATIVE"]));
  });
});

describe("untrusted JSON and pointers", () => {
  it.each(['{"decision":"FAIL","decision":"PASS"}', '{"a":1,"\\u0061":2}', '{"n":1e309}', '{"a":1} trailing'])("rejects ambiguous or invalid JSON: %s", text => {
    expect(() => parseJson(Buffer.from(text))).toThrow();
  });
  it("bounds bytes, nesting, and invalid UTF-8 rather than normalizing them", () => {
    expect(() => parseJson(Buffer.alloc(1024 * 1024 + 1))).toThrow("JSON_TOO_LARGE");
    expect(() => parseJson(Buffer.from("[".repeat(42) + "0" + "]".repeat(42)))).toThrow("JSON_COMPLEXITY_LIMIT");
    expect(() => parseJson(Uint8Array.from([0xc3, 0x28]))).toThrow("JSON_UTF8_INVALID");
  });
  it("supports escaped own-property pointers without traversing prototypes", () => {
    expect(pointer({ "a/b": { "~key": ["точная цитата"] } }, "/a~1b/~0key/0")).toBe("точная цитата");
    expect(() => pointer({}, "/toString")).toThrow("POINTER_NOT_FOUND");
    expect(() => pointer({ a: ["x"] }, "/a/00")).toThrow();
    expect(() => pointer({ a: "x" }, "/a~2")).toThrow("POINTER_INVALID");
    expect(canonicalJson({ z: 1, a: 2 })).toBe(canonicalJson({ a: 2, z: 1 }));
  });
});

describe("local filesystem and offline CLI", () => {
  it("pins the complete plan, preserves evidence bytes and seals new private bundles", async () => {
    const f = fixture(), disk = persist(f), out = join(disk.root, "sealed");
    const before = readFileSync(join(disk.root, f.plan.cases[0].raw!.path));
    await bundle(disk.path, disk.pin, out);
    const loaded = await loadBundle(out, disk.pin);
    expect(evaluate(loaded.plan, loaded.objects).decision).toBe("REVIEW_PASS");
    expect(readFileSync(join(disk.root, f.plan.cases[0].raw!.path))).toEqual(before);
    expect(statSync(out).mode & 0o777).toBe(0o700);
    expect(statSync(join(out, "plan.json")).mode & 0o777).toBe(0o600);
    expect(statSync(join(out, "objects", f.plan.cases[0].raw!.sha256)).mode & 0o777).toBe(0o600);
    await expect(bundle(disk.path, disk.pin, out)).rejects.toThrow();
    await expect(loadPlan(disk.path, "e".repeat(64))).rejects.toThrow("PLAN_PIN_MISMATCH");
  });
  it.each(["../outside.json", "/tmp/outside.json", "raw//case.json", "raw/./case.json", "raw\\case.json", "https://example.invalid/raw"])("rejects manifest path %s", async path => {
    const f = fixture(), disk = persist(f); f.plan.cases[0].input.path = path;
    const changed = savePlan(disk.root, f.plan);
    await expect(loadPlan(changed.path, changed.pin)).rejects.toThrow("ARTIFACT_PATH_INVALID");
  });
  it("refuses symlink evidence, including an intermediate linked directory", async () => {
    const f = fixture(), disk = persist(f), raw = f.plan.cases[0].raw!;
    const original = join(disk.root, raw.path), elsewhere = join(disk.root, "elsewhere.json");
    writeFileSync(elsewhere, readFileSync(original)); rmSync(original); symlinkSync(elsewhere, original);
    await expect(loadPlan(disk.path, disk.pin)).rejects.toThrow("ARTIFACT_SYMLINK_FORBIDDEN");
    const g = fixture(), other = persist(g), dir = join(other.root, "raw"), moved = join(other.root, "real-raw");
    mkdirSync(moved); for (const c of g.plan.cases) writeFileSync(join(moved, c.raw!.path.split("/").at(-1)!), g.objects.get(c.raw!.sha256)!);
    rmSync(dir, { recursive: true }); symlinkSync(moved, dir);
    await expect(loadPlan(other.path, other.pin)).rejects.toThrow("ARTIFACT_SYMLINK_FORBIDDEN");
  });
  it("rejects mutated sealed evidence and an interrupted bundle without its plan", async () => {
    const f = fixture(), disk = persist(f), out = join(disk.root, "sealed"); await bundle(disk.path, disk.pin, out);
    writeFileSync(join(out, "objects", f.plan.cases[0].raw!.sha256), "{}");
    await expect(loadBundle(out, disk.pin)).rejects.toThrow("ARTIFACT_HASH_MISMATCH");
    const interrupted = join(disk.root, "interrupted"); mkdirSync(interrupted); mkdirSync(join(interrupted, "objects"));
    await expect(loadBundle(interrupted, disk.pin)).rejects.toThrow();
  });
  it("enforces input size limits before trying to validate or print its contents", async () => {
    const f = fixture(), disk = persist(f), oversized = Buffer.alloc(256 * 1024 + 1, 32);
    const input = f.plan.cases[0].input; writeFileSync(join(disk.root, input.path), oversized); input.sha256 = sha256(oversized);
    const changed = savePlan(disk.root, f.plan);
    await expect(loadPlan(changed.path, changed.pin)).rejects.toThrow("ARTIFACT_TOO_LARGE");
  });
  it("runs the CLI with network denied and redacts errors instead of printing evidence or credentials", () => {
    const f = fixture(), disk = persist(f), guard = join(disk.root, "deny-network.cjs");
    writeFileSync(guard, `const deny=()=>{throw Error('TEST_NETWORK_FORBIDDEN')};globalThis.fetch=deny;require('node:http').request=deny;require('node:https').request=deny;require('node:net').Socket.prototype.connect=deny;`);
    const command = resolve("scripts/individual-report-acceptance.ts"), base = ["--require", guard, "--import", "tsx", command];
    const env = { ...process.env, OPENAI_API_KEY: "SECRET_SENTINEL_DO_NOT_PRINT", SUPABASE_SERVICE_ROLE_KEY: "SECOND_SECRET_SENTINEL" };
    const good = JSON.parse(execFileSync(process.execPath, [...base, "inspect", "--plan", disk.path, "--expected-plan-sha256", disk.pin], { encoding: "utf8", env }));
    expect(good.decision).toBe("REVIEW_PASS");
    const out = join(disk.root, "cli-bundle");
    const packed = JSON.parse(execFileSync(process.execPath, [...base, "bundle", "--plan", disk.path, "--expected-plan-sha256", disk.pin, "--out", out], { encoding: "utf8", env }));
    expect(packed).toMatchObject({ status: "BUNDLED", acceptance: "NOT_EVALUATED" });
    const sealed = JSON.parse(execFileSync(process.execPath, [...base, "evaluate", "--bundle", out, "--expected-plan-sha256", disk.pin], { encoding: "utf8", env }));
    expect(sealed.decision).toBe("REVIEW_PASS");
    const held = fixture(); changeReview(held, 1, "boundary", r => { r.verdict = "FAIL"; });
    const heldDisk = persist(held);
    const rejected = spawnSync(process.execPath, [...base, "inspect", "--plan", heldDisk.path, "--expected-plan-sha256", heldDisk.pin], { encoding: "utf8", env });
    expect(rejected.status).toBe(1); expect(JSON.parse(rejected.stdout).decision).toBe("HOLD");
    const bad = spawnSync(process.execPath, [...base, "inspect", "--plan", disk.path + "-PRIVATE_FILENAME", "--expected-plan-sha256", disk.pin], { encoding: "utf8", env });
    expect(bad.status).toBe(1); expect(JSON.parse(bad.stdout)).toEqual({ decision: "HOLD", reasons: ["LOCAL_IO_ERROR"] });
    expect(bad.stdout + bad.stderr).not.toMatch(/SECRET_SENTINEL|PRIVATE_FILENAME|INVENTED-|TEST_NETWORK_FORBIDDEN/);
    const invalid = spawnSync(process.execPath, [...base, "inspect", "--plan", disk.path, "--plan", disk.path], { encoding: "utf8", env });
    expect(invalid.status).toBe(1); expect(JSON.parse(invalid.stdout).reasons).toEqual(["ARGUMENTS_INVALID"]);
  }, 15000);
});
