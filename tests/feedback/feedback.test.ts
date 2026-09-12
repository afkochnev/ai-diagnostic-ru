import { describe, expect, it } from "vitest";
import { feedbackSchema, normalizeFeedbackInput } from "@/server/feedback/validation";
import { readFileSync } from "node:fs";

describe("feedback contract", () => {
  it("accepts a 1-5 rating and normalizes optional text to null", () => {
    const parsed = feedbackSchema.safeParse({ diagnostic_id: "9152284d-1974-4a60-a80f-2adee6bf6fd5", rating: 5, useful: "  Полезно  ", improve: "   " });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(normalizeFeedbackInput(parsed.data)).toMatchObject({ useful: "Полезно", improve: null });
  });
  it("rejects ratings outside 1-5 and non-integers", () => {
    for (const rating of [0, 6, 2.5]) expect(feedbackSchema.safeParse({ diagnostic_id: "9152284d-1974-4a60-a80f-2adee6bf6fd5", rating }).success).toBe(false);
  });
  it("keeps the MVP feedback contract and regression boundaries", () => {
    const migration = readFileSync("supabase/migrations/20260915000100_feedback.sql", "utf8");
    const page = readFileSync("src/app/[locale]/(workspace)/diagnostics/[diagnosticId]/result/page.tsx", "utf8");
    expect(migration).toContain("unique (user_id, diagnostic_id)");
    expect(migration).toContain("rating integer not null check (rating between 1 and 5)");
    expect(migration).toContain("create_feedback");
    expect(migration).not.toContain("jobs");
    expect(page).toContain("FeedbackModal");
  });
});
