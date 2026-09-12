import { expect, it } from "vitest";
import Decimal from "decimal.js";
import { calculateBlockScore, calculateOverall, classifyMaturity, mapDisplayScore } from "@/server/scoring/engine";

const q = (id: string, reverse_score = false) => ({ id, weight: 1, reverse_score, is_required: true, is_active: true, answer_type: "scale_0_4" as const });
it("maps user-facing 1..5 to internal 0..4", () => expect([1,2,3,4,5].map(mapDisplayScore)).toEqual([0,1,2,3,4]));
it("calculates weighted block score exactly", () => expect(calculateBlockScore({ block_id:"b", block_weight:1, questions:[q("1"),q("2")], answers:[{question_id:"1",numeric_value:0},{question_id:"2",numeric_value:4}] }).raw.toString()).toBe("50"));
it("supports reverse scoring", () => expect(calculateBlockScore({ block_id:"b", block_weight:1, questions:[q("1",true)], answers:[{question_id:"1",numeric_value:1}] }).raw.toString()).toBe("75"));
it("calculates min/max and golden overall without intermediate rounding", () => {
  const min = calculateBlockScore({block_id:"b",block_weight:1,questions:[q("1")],answers:[{question_id:"1",numeric_value:0}]});
  const max = calculateBlockScore({block_id:"b",block_weight:1,questions:[q("1")],answers:[{question_id:"1",numeric_value:4}]});
  expect(min.raw.toString()).toBe("0"); expect(max.raw.toString()).toBe("100");
  const overall = calculateOverall([50,50,60,60,70,70,80,70].map((raw,i)=>({block_id:String(i),raw:new Decimal(raw),display:new Decimal(raw),block_weight:1})));
  expect(overall.raw.toString()).toBe("63.75"); expect(overall.display.toString()).toBe("63.8");
});
it("classifies raw boundaries and keeps 69.96 in level 3", () => { expect(classifyMaturity(0)).toBe(1); expect(classifyMaturity("29.999")).toBe(1); expect(classifyMaturity(30)).toBe(2); expect(classifyMaturity(50)).toBe(3); expect(classifyMaturity("69.96")).toBe(3); expect(classifyMaturity(70)).toBe(4); expect(classifyMaturity(85)).toBe(5); expect(classifyMaturity(100)).toBe(5); });
it("rejects missing answers", () => expect(() => calculateBlockScore({ block_id:"b",block_weight:1,questions:[q("1")],answers:[] })).toThrow());
