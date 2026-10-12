import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

type JsonObject = Record<string, unknown>;

export type MethodologyVersionAudit = {
  version_number: number;
  metadata: JsonObject;
  counts: Record<string, number>;
  translation_integrity: JsonObject;
  structure_question_3: string | null;
  canonical: JsonObject;
};

export type MethodologyAudit = {
  audit_schema_version: number;
  versions: MethodologyVersionAudit[];
  version3?: unknown;
};

export const STRUCTURE_QUESTION_3 = {
  2: "В распределении функций и ответственности между подразделениями нет существенных дублирований и «белых пятен», за которые фактически никто не отвечает.",
  4: "В распределении функций и ответственности между подразделениями нет существенного дублирования и «белых пятен», за которые фактически никто не отвечает.",
};

const REQUIRED_COUNTS: Record<string, number> = {
  total_blocks: 10,
  scoring_blocks: 8,
  active_scoring_blocks: 8,
  total_questions: 84,
  scoring_questions: 80,
  active_scoring_questions: 80,
  company_info_questions: 2,
  open_questions: 2,
  scoring_policies: 1,
  maturity_levels: 5,
};

function object(value: unknown, context: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Expected object: ${context}`);
  }
  return value as JsonObject;
}

function rows(value: unknown, context: string): JsonObject[] {
  if (!Array.isArray(value)) throw new Error(`Expected array: ${context}`);
  return value.map((item) => object(item, context));
}

function omit(value: JsonObject, keys: string[]): JsonObject {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
}

/** Object property ordering is irrelevant; configuration array ordering is not. */
export function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as JsonObject).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`).join(",")}}`;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error("Non-JSON value in methodology audit");
  return serialized;
}

function sortedUnique(items: JsonObject[], key: string, context: string): JsonObject[] {
  const identities = new Set<unknown>();
  for (const item of items) {
    if (typeof item[key] !== "string" || identities.has(item[key])) {
      throw new Error(`Missing or duplicate logical key ${key}: ${context}`);
    }
    identities.add(item[key]);
  }
  return items.sort((a, b) => String(a[key]) < String(b[key]) ? -1 : String(a[key]) > String(b[key]) ? 1 : 0);
}

function translations(value: unknown, parentKey: string, context: string): JsonObject[] {
  return sortedUnique(rows(value, context).map((item) => omit(item, [parentKey])), "locale", context);
}

/**
 * Exclude only surrogate identities and documented provenance fields at their
 * known locations. Never strip similarly named keys from policy/configuration.
 * SQL resolves UUID relationships into block_key before emitting this shape.
 */
export function canonicalMethodology(value: unknown): JsonObject {
  const content = object(value, "canonical");
  const definition = object(content.definition, "definition");
  const version = object(content.version, "version");
  const blocks = sortedUnique(rows(content.blocks, "blocks").map((block) => ({
    ...omit(block, ["id", "version_id"]),
    translations: translations(block.translations, "block_id", "block translations"),
  })), "key", "blocks");
  const questions = sortedUnique(rows(content.questions, "questions").map((question) => {
    if (typeof question.block_key !== "string" || !blocks.some((block) => block.key === question.block_key)) {
      throw new Error(`Question references missing logical block: ${String(question.key)}`);
    }
    return {
      ...omit(question, ["id", "version_id", "block_id"]),
      translations: translations(question.translations, "question_id", "question translations"),
      options: sortedUnique(rows(question.options, "options").map((option) => ({
        ...omit(option, ["id", "question_id"]),
        translations: translations(option.translations, "option_id", "option translations"),
      })), "key", "options"),
    };
  }), "key", "questions");
  const policies = rows(content.scoring_policies, "scoring_policies")
    .map((policy) => omit(policy, ["id", "version_id", "policy_hash"]))
    .sort((a, b) => stableSerialize(a) < stableSerialize(b) ? -1 : stableSerialize(a) > stableSerialize(b) ? 1 : 0);
  const maturity = sortedUnique(rows(content.maturity_levels, "maturity_levels").map((level) => ({
    ...omit(level, ["id", "version_id"]),
    translations: translations(level.translations, "maturity_level_id", "maturity translations"),
  })), "key", "maturity_levels");
  return {
    ...content,
    definition: omit(definition, ["id", "created_at"]),
    version: omit(version, ["id", "definition_id", "content_hash", "source_file", "published_at"]),
    translations: translations(content.translations, "version_id", "version translations"),
    blocks,
    questions,
    scoring_policies: policies,
    maturity_levels: maturity,
  };
}

/** Supports raw JSON, psql JSON column rows, and Supabase CLI {rows:[...]} output. */
export function parseMethodologyAudit(value: unknown): MethodologyAudit {
  let candidate = value;
  const wrapper = candidate && !Array.isArray(candidate) && typeof candidate === "object" ? candidate as JsonObject : null;
  if (wrapper && Array.isArray(wrapper.rows)) candidate = wrapper.rows;
  if (Array.isArray(candidate)) {
    if (candidate.length !== 1) throw new Error("Expected exactly one methodology audit row");
    candidate = candidate[0];
  }
  const row = object(candidate, "audit");
  if ("methodology_audit" in row) candidate = row.methodology_audit;
  if (typeof candidate === "string") candidate = JSON.parse(candidate);
  const audit = object(candidate, "methodology audit");
  if (audit.audit_schema_version !== 1 || !Array.isArray(audit.versions)) {
    throw new Error("Unsupported or incomplete methodology audit schema");
  }
  const numbers = new Set<unknown>();
  for (const raw of audit.versions) {
    const version = object(raw, "version audit");
    if (!Number.isInteger(version.version_number) || numbers.has(version.version_number)) {
      throw new Error("Missing or duplicate methodology version number");
    }
    numbers.add(version.version_number);
    object(version.metadata, "metadata");
    object(version.counts, "counts");
    object(version.translation_integrity, "translation_integrity");
    canonicalMethodology(version.canonical);
  }
  return audit as unknown as MethodologyAudit;
}

function differences(a: unknown, b: unknown, path = "$", result: string[] = []): string[] {
  if (stableSerialize(a) === stableSerialize(b)) return result;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) result.push(`${path}.length`);
    for (let i = 0; i < Math.min(a.length, b.length); i++) differences(a[i], b[i], `${path}[${i}]`, result);
  } else if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    const ao = a as JsonObject;
    const bo = b as JsonObject;
    for (const key of [...new Set([...Object.keys(ao), ...Object.keys(bo)])].sort()) {
      if (!(key in ao) || !(key in bo)) result.push(`${path}.${key}`);
      else differences(ao[key], bo[key], `${path}.${key}`, result);
    }
  } else result.push(path);
  return result;
}

export function validateVersion(version: MethodologyVersionAudit, versionNumber: 2 | 4): string[] {
  const errors: string[] = [];
  const canonical = canonicalMethodology(version.canonical);
  const definition = object(canonical.definition, "definition");
  const versionContent = object(canonical.version, "version");
  if (definition.key !== "manageability") errors.push("canonical definition_key");
  if (versionContent.version_number !== versionNumber) errors.push("canonical version_number");
  if (versionContent.status !== "published") errors.push("canonical status must be published");
  if (version.version_number !== versionNumber) errors.push("version_number");
  if (version.metadata.definition_key !== "manageability") errors.push("definition_key");
  if (version.metadata.status !== "published") errors.push("status must be published");
  for (const [key, expected] of Object.entries(REQUIRED_COUNTS)) {
    if (version.counts[key] !== expected) errors.push(`${key}: expected ${expected}, got ${String(version.counts[key])}`);
  }
  const blocks = rows(canonical.blocks, "blocks");
  const questions = rows(canonical.questions, "questions");
  const blockByKey = new Map(blocks.map((block) => [block.key, block]));
  const actualCounts: Record<string, number> = {
    total_blocks: blocks.length,
    scoring_blocks: blocks.filter((block) => Number(block.weight) > 0).length,
    active_scoring_blocks: blocks.filter((block) => Number(block.weight) > 0 && block.is_active).length,
    total_questions: questions.length,
    scoring_questions: questions.filter((question) => !["company_info", "open_questions"].includes(String(question.block_key)) && Number(question.weight) > 0).length,
    active_scoring_questions: questions.filter((question) => Number(blockByKey.get(question.block_key)?.weight) > 0 && blockByKey.get(question.block_key)?.is_active && Number(question.weight) > 0 && question.is_active && question.answer_type === "scale_0_4").length,
    company_info_questions: questions.filter((question) => question.block_key === "company_info").length,
    open_questions: questions.filter((question) => question.block_key === "open_questions").length,
    scoring_policies: rows(canonical.scoring_policies, "scoring_policies").length,
    maturity_levels: rows(canonical.maturity_levels, "maturity_levels").length,
  };
  for (const [key, actual] of Object.entries(actualCounts)) {
    if (actual !== version.counts[key]) errors.push(`canonical ${key}: differs from SQL count`);
  }
  if (version.translation_integrity.required_locale !== "ru") errors.push("required_locale must be ru");
  for (const key of ["missing_version", "missing_blocks", "missing_questions", "missing_options", "missing_maturity"]) {
    if (version.translation_integrity[key] !== 0) errors.push(`${key}: expected 0, got ${String(version.translation_integrity[key])}`);
  }
  function requiredTranslation(item: JsonObject, textKey: string): boolean {
    return rows(item.translations, "translations").some((translation) => translation.locale === "ru" && typeof translation[textKey] === "string" && String(translation[textKey]).trim().length > 0);
  }
  if (!requiredTranslation(canonical, "title") || blocks.some((block) => !requiredTranslation(block, "title")) || questions.some((question) => !requiredTranslation(question, "prompt")) || questions.some((question) => rows(question.options, "options").some((option) => !requiredTranslation(option, "label"))) || rows(canonical.maturity_levels, "maturity_levels").some((level) => !requiredTranslation(level, "label"))) {
    errors.push("canonical required ru translations missing");
  }
  if (version.structure_question_3 !== STRUCTURE_QUESTION_3[versionNumber]) errors.push("structure_question_3: approved wording mismatch");
  const structure = questions.find((question) => question.block_key === "structure" && question.position === 3);
  if (!structure || !rows(structure.translations, "structure translations").some((translation) => translation.locale === "ru" && translation.prompt === STRUCTURE_QUESTION_3[versionNumber])) {
    errors.push("canonical structure_question_3: approved wording mismatch");
  }
  return errors;
}

export function compareMethodologyAudits(stagingValue: unknown, productionValue: unknown) {
  const staging = parseMethodologyAudit(stagingValue);
  const production = parseMethodologyAudit(productionValue);
  const versions = ([2, 4] as const).map((versionNumber) => {
    const a = staging.versions.find((version) => version.version_number === versionNumber);
    const b = production.versions.find((version) => version.version_number === versionNumber);
    if (!a || !b) throw new Error(`Missing methodology version ${versionNumber}`);
    const ac = canonicalMethodology(a.canonical);
    const bc = canonicalMethodology(b.canonical);
    const left = stableSerialize(ac);
    const right = stableSerialize(bc);
    const stagingErrors = validateVersion(a, versionNumber);
    const productionErrors = validateVersion(b, versionNumber);
    return {
      version_number: versionNumber,
      logically_equal: left === right,
      staging_sha256: createHash("sha256").update(left).digest("hex"),
      production_sha256: createHash("sha256").update(right).digest("hex"),
      differences: differences(ac, bc),
      content_hash_difference: a.metadata.content_hash !== b.metadata.content_hash,
      provenance_only_difference: left === right && stableSerialize(a.metadata) !== stableSerialize(b.metadata),
      integrity: { staging: stagingErrors, production: productionErrors },
      pass: left === right && stagingErrors.length === 0 && productionErrors.length === 0,
    };
  });
  return { pass: versions.every((version) => version.pass), versions };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [stagingPath, productionPath] = process.argv.slice(2);
    if (!stagingPath || !productionPath || process.argv.length !== 4) {
      throw new Error("Usage: node --import tsx scripts/compare-methodology-parity.ts STAGING_JSON PRODUCTION_JSON");
    }
    const result = compareMethodologyAudits(JSON.parse(readFileSync(stagingPath, "utf8")), JSON.parse(readFileSync(productionPath, "utf8")));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = result.pass ? 0 : 1;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
