import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
const provider = vi.hoisted(() => ({ create: vi.fn(), constructed: vi.fn() }));
vi.mock("openai", () => ({ default: class {
  responses = { create: provider.create };
  constructor() { provider.constructed(); }
} }));
import { generateReport, type IndividualPromptVersion } from "@/server/ai/report";
import { CURRENT_INDIVIDUAL_PROMPT_VERSION, INDIVIDUAL_PROMPT_VERSIONS } from "@/server/ai/prompt-version";
const content = {
  summary:"Синтетическое резюме",main_diagnosis:"Синтетический диагноз",manageability_index_text:"Тестовый индекс",
  strengths:["Один","Два"],key_problem_zones:["Один","Два"],growth_constraint:"Тестовое ограничение",
  implementation_risks:["Один","Два","Три"],first_actions:["Один","Два","Три"],
  plan_30_days:["Тридцать"],plan_60_days:["Шестьдесят"],plan_90_days:["Девяносто"],next_step:"Тестовый шаг",
};
beforeEach(()=>{
  vi.clearAllMocks();vi.stubEnv("FREE_SMOKE_ENABLED","false");vi.stubEnv("AI_REPORT_PROVIDER","openai");vi.stubEnv("OPENAI_API_KEY","synthetic-not-a-real-key");
  provider.create.mockResolvedValue({id:"synthetic",output_text:JSON.stringify(content)});
});
describe("explicit Individual prompt selection",()=>{
  it("current revision is independent of generation count",()=>expect(CURRENT_INDIVIDUAL_PROMPT_VERSION).toBe("RU-1.5"));
  it.each(INDIVIDUAL_PROMPT_VERSIONS)("loads the exact retained %s asset into the provider request",async version=>{
    await generateReport({synthetic:true},version);
    const request=provider.create.mock.calls[0][0];
    expect(request.input[0]).toEqual({role:"system",content:readFileSync(`AI_REPORT_PROMPT_${version.replaceAll("-","_").replaceAll(".","_")}.md`,"utf8")});
    expect(provider.create).toHaveBeenCalledOnce();
  });
  it.each([undefined,null,"","RU-9.9","../secret"])("denies missing/unknown prompt %s even with a mock provider",async invalid=>{
    vi.stubEnv("AI_REPORT_PROVIDER","mock");
    await expect(generateReport({},invalid as IndividualPromptVersion)).rejects.toThrow("invalid_individual_prompt_version");
    expect(provider.constructed).not.toHaveBeenCalled();expect(provider.create).not.toHaveBeenCalled();
  });
});
