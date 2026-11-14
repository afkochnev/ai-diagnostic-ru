import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";

describe("production prompt assets", () => {
  it("contains every historical and active prompt asset", () => {
    for (const version of ["1_0", "1_1", "1_2", "1_3", "1_5", "1_6"]) expect(existsSync(`AI_REPORT_PROMPT_RU_${version}.md`)).toBe(true);
  });

  it.each(["1_5", "1_6"])("copies RU-%s into the final runtime image", version => {
    const dockerfile = readFileSync("Dockerfile", "utf8");
    const file = `AI_REPORT_PROMPT_RU_${version}.md`;
    expect(dockerfile).toContain(`COPY --from=build /app/${file} ./${file}`);
    expect(readFileSync(file, "utf8")).toContain("Граница доверия");
  });
});
