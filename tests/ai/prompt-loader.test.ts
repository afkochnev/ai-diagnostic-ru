import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";

describe("production prompt assets", () => {
  it("contains every historical and active prompt asset", () => {
    for (const version of ["1_0", "1_1", "1_2", "1_3"]) expect(existsSync(`AI_REPORT_PROMPT_RU_${version}.md`)).toBe(true);
  });

  it("copies RU-1.3 into the final runtime image", () => {
    const dockerfile = readFileSync("Dockerfile", "utf8");
    expect(dockerfile).toContain("COPY --from=build /app/AI_REPORT_PROMPT_RU_1_3.md ./AI_REPORT_PROMPT_RU_1_3.md");
    expect(readFileSync("AI_REPORT_PROMPT_RU_1_3.md", "utf8")).toContain("Граница доверия");
  });
});
