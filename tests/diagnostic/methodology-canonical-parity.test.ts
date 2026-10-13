import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  canonicalMethodology,
  compareMethodologyAudits,
  parseMethodologyAudit,
  stableSerialize,
  STRUCTURE_QUESTION_3,
  type MethodologyAudit,
  type MethodologyVersionAudit,
} from "../../scripts/compare-methodology-parity";

type Row = Record<string, unknown>;

function fixtureVersion(versionNumber: 2 | 4): MethodologyVersionAudit {
  const blockKeys = ["company_info", "strategy", "structure", "processes", "people", "control", "finance", "culture", "leadership", "open_questions"];
  const blocks = blockKeys.map((key, index) => ({
    key, position: index + 1, weight: index === 0 || index === 9 ? 0 : 1, is_active: true,
    translations: [{ locale: "ru", title: `Блок ${key}`, description: null }],
  }));
  const questions = blocks.flatMap((block) => Array.from({ length: block.weight ? 10 : 2 }, (_, index) => ({
    key: `${block.key}_${index + 1}`, block_key: block.key, position: index + 1,
    answer_type: block.weight ? "scale_0_4" : "text", weight: block.weight ? 1 : 0,
    is_required: true, is_active: true, reverse_score: false,
    legacy_ai_context_label: `Контекст ${block.key}`, legacy_bubble_unique_id: null,
    translations: [{ locale: "ru", prompt: block.key === "structure" && index === 2 ? STRUCTURE_QUESTION_3[versionNumber] : `Вопрос ${block.key} ${index + 1}`, help_text: null }],
    options: block.weight ? Array.from({ length: 5 }, (_, score) => ({ key: `option_${score}`, position: score + 1, score_value: score, translations: [{ locale: "ru", label: `Оценка ${score}` }] })) : [],
  })));
  return {
    version_number: versionNumber,
    metadata: { id: `version-${versionNumber}`, definition_key: "manageability", status: "published", published_at: "2026-10-01", content_hash: "provenance", source_file: "methodology.csv" },
    counts: { total_blocks: 10, scoring_blocks: 8, active_scoring_blocks: 8, total_questions: 84, scoring_questions: 80, active_scoring_questions: 80, company_info_questions: 2, open_questions: 2, scoring_policies: 1, maturity_levels: 5 },
    translation_integrity: { required_locale: "ru", missing_version: 0, missing_blocks: 0, missing_questions: 0, missing_options: 0, missing_maturity: 0 },
    structure_question_3: STRUCTURE_QUESTION_3[versionNumber],
    canonical: {
      definition: { key: "manageability" }, version: { version_number: versionNumber, status: "published" },
      translations: [{ locale: "ru", title: "Управляемость", description: "Описание" }],
      blocks, questions,
      scoring_policies: [{ engine_key: "weighted", engine_version: "1", schema_version: "1", configuration: { scale: { min: 0, max: 4 }, steps: ["normalize", "weight"], id: "behavior-key" } }],
      maturity_levels: Array.from({ length: 5 }, (_, index) => ({ key: `level_${index}`, position: index + 1, classification_config: { min: index * 20, max: (index + 1) * 20 }, translations: [{ locale: "ru", label: `Уровень ${index}`, description: null }] })),
    },
  };
}

function fixture(): MethodologyAudit {
  return { audit_schema_version: 1, versions: [fixtureVersion(2), fixtureVersion(4)] };
}

function contentRows(audit: MethodologyAudit, field: string): Row[] {
  return audit.versions[0].canonical[field] as Row[];
}

describe("canonical full methodology comparison", () => {
  it("accepts CLI wrapper output and hashes identical valid logical versions", () => {
    const audit = fixture();
    const result = compareMethodologyAudits({ rows: [{ methodology_audit: audit }] }, [{ methodology_audit: JSON.stringify(audit) }]);
    expect(result.pass).toBe(true);
    expect(result.versions.map((version) => version.logically_equal)).toEqual([true, true]);
    expect(result.versions[0].staging_sha256).toBe(result.versions[0].production_sha256);
  });

  it("ignores surrogate identities/provenance and sorts entity/translation rows", () => {
    const a = fixture();
    const b = structuredClone(a);
    for (const version of b.versions) {
      version.metadata = { ...version.metadata, id: "other-version-uuid", content_hash: "repaired-provenance", source_file: "reconstructed.csv", published_at: "other-date" };
      version.canonical.definition = { ...(version.canonical.definition as Row), id: "other-definition-uuid", created_at: "other-date" };
      version.canonical.version = { ...(version.canonical.version as Row), id: "other-version-uuid", definition_id: "other-definition-uuid", content_hash: "repaired-provenance", source_file: "reconstructed.csv", published_at: "other-date" };
      for (const block of version.canonical.blocks as Row[]) {
        block.id = "other-block-uuid"; block.version_id = "other-version-uuid";
        for (const translation of block.translations as Row[]) translation.block_id = "other-block-uuid";
      }
      for (const question of version.canonical.questions as Row[]) {
        question.id = "other-question-uuid"; question.version_id = "other-version-uuid"; question.block_id = "other-block-uuid";
        for (const translation of question.translations as Row[]) translation.question_id = "other-question-uuid";
        for (const option of question.options as Row[]) {
          option.id = "other-option-uuid"; option.question_id = "other-question-uuid";
          for (const translation of option.translations as Row[]) translation.option_id = "other-option-uuid";
        }
        (question.options as Row[]).reverse();
      }
      for (const policy of version.canonical.scoring_policies as Row[]) Object.assign(policy, { id: "other-policy-uuid", version_id: "other-version-uuid", policy_hash: "repaired-provenance" });
      for (const maturity of version.canonical.maturity_levels as Row[]) {
        Object.assign(maturity, { id: "other-maturity-uuid", version_id: "other-version-uuid" });
        for (const translation of maturity.translations as Row[]) translation.maturity_level_id = "other-maturity-uuid";
      }
      (version.canonical.blocks as Row[]).reverse();
      (version.canonical.questions as Row[]).reverse();
      (version.canonical.maturity_levels as Row[]).reverse();
    }
    const result = compareMethodologyAudits(a, b);
    expect(result.pass).toBe(true);
    expect(result.versions[0].content_hash_difference).toBe(true);
    expect(result.versions[0].provenance_only_difference).toBe(true);
  });

  const mutations: [string, (audit: MethodologyAudit) => void][] = [
    ["definition", (audit) => (audit.versions[0].canonical.definition as Row).key = "other"],
    ["version lifecycle", (audit) => (audit.versions[0].canonical.version as Row).status = "retired"],
    ["version title", (audit) => (audit.versions[0].canonical.translations as Row[])[0].title = "Changed"],
    ["block weight", (audit) => contentRows(audit, "blocks")[1].weight = 2],
    ["block position", (audit) => contentRows(audit, "blocks")[1].position = 12],
    ["block title", (audit) => (contentRows(audit, "blocks")[1].translations as Row[])[0].title = "Changed"],
    ["question wording", (audit) => (contentRows(audit, "questions")[2].translations as Row[])[0].prompt = "Changed"],
    ["question help", (audit) => (contentRows(audit, "questions")[2].translations as Row[])[0].help_text = "Changed"],
    ["question weight", (audit) => contentRows(audit, "questions")[2].weight = 2],
    ["question reverse scoring", (audit) => contentRows(audit, "questions")[2].reverse_score = true],
    ["question required", (audit) => contentRows(audit, "questions")[2].is_required = false],
    ["AI context label", (audit) => contentRows(audit, "questions")[2].legacy_ai_context_label = "Changed"],
    ["option score", (audit) => (contentRows(audit, "questions")[2].options as Row[])[0].score_value = 4],
    ["option label", (audit) => ((contentRows(audit, "questions")[2].options as Row[])[0].translations as Row[])[0].label = "Changed"],
    ["policy engine", (audit) => contentRows(audit, "scoring_policies")[0].engine_version = "2"],
    ["policy configuration", (audit) => (contentRows(audit, "scoring_policies")[0].configuration as Row).scale = { min: 1, max: 4 }],
    ["configuration named id", (audit) => (contentRows(audit, "scoring_policies")[0].configuration as Row).id = "changed-behavior-key"],
    ["configuration array ordering", (audit) => (contentRows(audit, "scoring_policies")[0].configuration as Row).steps = ["weight", "normalize"]],
    ["maturity thresholds", (audit) => contentRows(audit, "maturity_levels")[0].classification_config = { min: 0, max: 30 }],
    ["maturity label", (audit) => (contentRows(audit, "maturity_levels")[0].translations as Row[])[0].label = "Changed"],
  ];

  it.each(mutations)("detects actual %s difference", (_label, mutate) => {
    const a = fixture();
    const b = structuredClone(a);
    mutate(b);
    const result = compareMethodologyAudits(a, b);
    expect(result.pass).toBe(false);
    expect(result.versions[0].logically_equal).toBe(false);
    expect(result.versions[0].differences.length).toBeGreaterThan(0);
    expect(result.versions[1].pass).toBe(true);
  });

  it("fails the gate for equally incomplete or wrong translated inputs", () => {
    const audit = fixture();
    audit.versions[0].translation_integrity.missing_questions = 1;
    (contentRows(audit, "questions")[2].translations as Row[]) = [];
    const result = compareMethodologyAudits(audit, audit);
    expect(result.versions[0].logically_equal).toBe(true);
    expect(result.versions[0].pass).toBe(false);
    expect(result.versions[0].integrity.staging).toContain("canonical required ru translations missing");
  });

  it("verifies exact approved structure wording separately for v2 and v4", () => {
    const audit = fixture();
    audit.versions[1].structure_question_3 = STRUCTURE_QUESTION_3[2];
    expect(compareMethodologyAudits(audit, audit).versions[1].integrity.staging).toContain("structure_question_3: approved wording mismatch");
  });

  it("rejects missing/duplicate versions, logical keys and broken block relationships", () => {
    expect(() => compareMethodologyAudits({ ...fixture(), versions: [] }, fixture())).toThrow("Missing methodology version 2");
    const duplicate = fixture();
    duplicate.versions.push(duplicate.versions[0]);
    expect(() => parseMethodologyAudit(duplicate)).toThrow("duplicate methodology version");
    const broken = fixture();
    contentRows(broken, "questions")[0].block_key = "missing";
    expect(() => parseMethodologyAudit(broken)).toThrow("missing logical block");
    const duplicateQuestion = fixture();
    contentRows(duplicateQuestion, "questions").push(contentRows(duplicateQuestion, "questions")[0]);
    expect(() => parseMethodologyAudit(duplicateQuestion)).toThrow("duplicate logical key");
  });

  it("compares all locales and preserves semantics of configuration object keys", () => {
    const a = fixture();
    const b = fixture();
    (contentRows(a, "questions")[2].translations as Row[]).push({ locale: "en", prompt: "English", help_text: null });
    (contentRows(b, "questions")[2].translations as Row[]).push({ locale: "en", prompt: "Changed English", help_text: null });
    expect(compareMethodologyAudits(a, b).versions[0].logically_equal).toBe(false);
    expect(stableSerialize({ x: { b: 2, a: 1 } })).toBe(stableSerialize({ x: { a: 1, b: 2 } }));
    expect(canonicalMethodology(a.versions[0].canonical)).toBeDefined();
  });
});

describe("reference-audit safety and coverage", () => {
  const sql = readFileSync("scripts/audit-methodology-parity.sql", "utf8");

  it("is one repeatable read read-only transaction with catalog-discovered composite-FK paths", () => {
    expect(sql).toContain("begin transaction isolation level repeatable read read only;");
    expect(sql).toContain("pg_catalog.pg_constraint");
    expect(sql).toContain("unnest(fk.conkey, fk.confkey)");
    expect(sql).toContain("where not fk.conrelid = any(p.relations)");
    expect(sql).not.toMatch(/\b(?:insert\s+into|update\s+public|delete\s+from|alter\s+table|create\s+table)\b/i);
  });

  it("counts unique downstream rows while preserving per-path coverage evidence", () => {
    expect(sql).toContain("t%s.ctid::text as row_identity");
    expect(sql).toContain("' union '");
    expect(sql).toContain("'table_counts'");
    expect(sql).toContain("'foreign_key_coverage'");
    expect(sql).toContain("'fk_paths'");
    expect(sql).toContain("d.key = ''manageability'' and v.version_number = 3");
  });
});
