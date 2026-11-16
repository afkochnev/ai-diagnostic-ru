import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { INDIVIDUAL_PROMPT_VERSIONS } from "@/server/ai/prompt-version";

describe("production prompt assets", () => {
  it("contains every historical and active prompt asset", () => {
    for (const version of INDIVIDUAL_PROMPT_VERSIONS) {
      expect(existsSync(`AI_REPORT_PROMPT_${version.replaceAll("-", "_").replaceAll(".", "_")}.md`)).toBe(true);
    }
  });

  it.each(["1_5", "1_6", "1_7", "1_8"])("copies RU-%s into the final runtime image", version => {
    const dockerfile = readFileSync("Dockerfile", "utf8");
    const file = `AI_REPORT_PROMPT_RU_${version}.md`;
    expect(dockerfile).toContain(`COPY --from=build /app/${file} ./${file}`);
    expect(readFileSync(file, "utf8")).toContain("Граница доверия");
  });
});
