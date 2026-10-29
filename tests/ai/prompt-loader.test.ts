import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { INDIVIDUAL_PROMPT_VERSIONS } from "@/server/ai/prompt-version";

describe("production prompt assets", () => {
  it.each(INDIVIDUAL_PROMPT_VERSIONS)("packages the retained %s asset in the final runtime image", version => {
    const file = `AI_REPORT_PROMPT_${version.replaceAll("-", "_").replaceAll(".", "_")}.md`;
    expect(existsSync(file)).toBe(true);
    expect(readFileSync("Dockerfile", "utf8")).toContain(`COPY --from=build /app/${file} ./${file}`);
  });

  it("preserves all historical prompt and schema bytes", () => {
    const retained = {
      "AI_REPORT_PROMPT_RU_1_0.md": "d80d6e110256ad00df4197aabd2ca95043298e66a8adaeb7b30524e7fd494206",
      "AI_REPORT_PROMPT_RU_1_1.md": "8e9544eb22757dcb9b867d92bf1d005ccd46ea2b1f4a76961dfc073bc4a00eaf",
      "AI_REPORT_PROMPT_RU_1_2.md": "65cf03ad279be94a4aecd90d02b5989276e3d47872d047de537b6aba6fcfdcb8",
      "AI_REPORT_PROMPT_RU_1_3.md": "2c93a81146170acd2bcf6f36ccd74e6510b163fd4ecbb0748b8f25ea6a3aeae9",
      "AI_REPORT_SCHEMA_RU_1_0.json": "ff05cd97c3392294b0ee027188dcf814d5f8a49b5dac1a5a700a4aaa567318de"
};
    for (const [file, sha256] of Object.entries(retained)) {
      expect(createHash("sha256").update(readFileSync(file)).digest("hex"), file).toBe(sha256);
    }
  });
});
