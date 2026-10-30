import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ existing: null as { id: string } | null, seeded: vi.fn(), company: { id: "company", key_problems: "Проблема", main_goals: "Цели" } }));
vi.mock("server-only", () => ({}));
vi.mock("@/server/account/authorization", () => ({ AccountAccessError: class extends Error {}, requireCompanyWrite: async () => m.company }));
vi.mock("@/server/company/queries", () => ({ getOwnCompany: async () => m.company }));
vi.mock("@/server/supabase/server", () => ({ createAuthClient: async () => ({ from(table: string) {
  let inserting = false;
  const result = () => {
    if (table === "diagnostics") return { data: inserting ? { id: "new-diagnostic" } : m.existing, error: null };
    if (table === "diagnostic_definitions") return { data: { id: "definition" }, error: null };
    if (table === "diagnostic_versions") return { data: [{ id: "version", definition_id: "definition", version_number: 2, status: "published" }], error: null };
    if (table === "diagnostic_blocks") return { data: { id: "first-block" }, error: null };
    if (table === "questions") return { data: [{ id: "problem", key: "main_management_problem", answer_type: "text" }, { id: "goal", key: "main_company_goal", answer_type: "text" }], error: null };
    throw Error(`Unexpected table ${table}`);
  };
  const query = { select: () => query, eq: () => query, in: () => query, order: () => query, limit: () => query,
    insert: () => { inserting = true; return query; }, upsert: m.seeded,
    maybeSingle: async () => result(), single: async () => result(), then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve),
  };
  return query;
} }) }));
import { createDiagnostic } from "@/server/diagnostic/service";
beforeEach(() => { vi.clearAllMocks(); m.existing = null; m.seeded.mockResolvedValue({ error: null }); });

describe("new Individual profile prefill persistence", () => {
  it("persists context with conflict-ignore so a concurrent real answer cannot be overwritten", async () => {
    expect(await createDiagnostic("user", "company")).toEqual({ id: "new-diagnostic", existing: false });
    expect(m.seeded).toHaveBeenCalledWith([
      { diagnostic_id: "new-diagnostic", version_id: "version", question_id: "problem", text_value: "Проблема" },
      { diagnostic_id: "new-diagnostic", version_id: "version", question_id: "goal", text_value: "Цели" },
    ], { onConflict: "diagnostic_id,question_id", ignoreDuplicates: true });
  });
  it("resumes existing diagnostics without writing profile context again", async () => {
    m.existing = { id: "in-progress" };
    expect(await createDiagnostic("user", "company")).toEqual({ id: "in-progress", existing: true });
    expect(m.seeded).not.toHaveBeenCalled();
  });
});
