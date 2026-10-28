import {describe,it,expect,vi} from "vitest";
import * as React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {classifyDispersion,formatDispersionPercent,DISPERSION_INTERPRETATION_VERSION,type DispersionProfile} from "@/shared/analytics/dispersion";
import {DispersionSummary,DispersionValue} from "@/features/team/dispersion";
vi.stubGlobal("React",React);
describe("dispersion interpretation v1",()=>{
 it.each([[0,4,"low"],[.4,4,"low"],[.5,4,"moderate"],[.8,4,"moderate"],[.9,4,"high"],[1.2,4,"high"],[1.4,4,"very_high"],[1.7,4,"very_high"],[10,100,"low"],[14.3,100,"moderate"],[20,100,"moderate"],[22.5,100,"high"],[30,100,"high"],[31,100,"very_high"]] as const)("classifies %s on scale %s",(sd,range,key)=>expect(classifyDispersion(sd,range).key).toBe(key));
 it.each([[18.9,"Умеренный"],[22.5,"Высокий"],[14.3,"Умеренный"],[18.9,"Умеренный"],[24.7,"Высокий"],[18.5,"Умеренный"],[19.7,"Умеренный"],[17.8,"Умеренный"],[17.1,"Умеренный"]])("preserves FoodTech regression %s",(sd,label)=>expect(classifyDispersion(Number(sd),100).label).toBe(label));
 it("classifies raw values, never localized or rounded display values",()=>{
  expect(classifyDispersion(1.247219128924647,4).key).toBe("very_high");expect(classifyDispersion(1.2,4).key).toBe("high");
  expect(classifyDispersion(10.00001,100).key).toBe("moderate");expect(classifyDispersion(20.00001,100).key).toBe("high");
  expect(classifyDispersion(30.00001,100).key).toBe("very_high");expect(classifyDispersion(24.666666,100).normalizedPercent).toBeCloseTo(24.666666);
  const html=renderToStaticMarkup(React.createElement(DispersionValue,{value:1.247219128924647,scaleRange:4}));expect(html).toContain("31,2%");expect(html).toContain("Очень высокий");
 });
 it.each([[-1,4],[NaN,4],[Infinity,4],[1,0],[1,-4],[1,NaN]])("rejects invalid input %s / %s",(sd,range)=>expect(()=>classifyDispersion(sd,range)).toThrow("invalid_dispersion"));
 it("is versioned and does not infer a strong practice or a conflict",()=>{
  const profile:DispersionProfile={participantCount:3,overall:{mean:20,stddev:0,maturity:"Низкая оценка"},blocks:[{position:1,title:"Практика с низкой оценкой",mean:20,stddev:0},{position:2,title:"Разные оценки",mean:50,stddev:40}],questions:[]};
  const before=JSON.stringify(profile),html=renderToStaticMarkup(React.createElement(DispersionSummary,{profile}));
  expect(DISPERSION_INTERPRETATION_VERSION).toBe("v1");expect(JSON.stringify(profile)).toBe(before);
  expect(html).toContain("не означает автоматически высокий уровень практики");expect(html).toContain("не являются статистическим доказательством конфликта");expect(html).toContain("не как статистическую оценку всей компании");
  expect(html).not.toContain("является сильной стороной");expect(html).not.toContain("Выявлен конфликт");expect(html).toContain("Низкий");expect(html).toContain("Очень высокий");
 });
});

 it("uses the same displayed dispersion units for UAT question and block without rounding before classification",()=>{
  const questionSD=Math.sqrt(2/3),blockSD=questionSD*25;
  expect(formatDispersionPercent(questionSD,4)).toBe("20,4%");
  expect(formatDispersionPercent(blockSD,100)).toBe("20,4%");
  const html=renderToStaticMarkup(React.createElement(DispersionValue,{value:questionSD,scaleRange:4}));
  expect(html).toContain("20,4%");expect(html).toContain("Высокий");
  expect(formatDispersionPercent(.8,4)).toBe("20%");expect(classifyDispersion(.8,4).key).toBe("moderate");
  const edge=renderToStaticMarkup(React.createElement(DispersionValue,{value:.800001,scaleRange:4}));
  expect(edge).toContain("20%");expect(edge).toContain("Высокий");
 });
