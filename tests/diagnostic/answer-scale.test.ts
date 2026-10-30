import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AnswerScale, AnswerScaleGuide, ANSWER_SCALE } from "@/features/diagnostic/answer-scale";

beforeEach(() => vi.stubGlobal("React", React));
afterEach(() => vi.unstubAllGlobals());

describe("shared questionnaire scale", () => {
  it("displays 1–5 while preserving storage values 0–4", () => {
    expect(ANSWER_SCALE.map((point) => [point.display, point.value])).toEqual([[1, 0], [2, 1], [3, 2], [4, 3], [5, 4]]);
    const markup = renderToStaticMarkup(React.createElement(AnswerScale, { name: "question", label: "Management practice", value: 0, onChange() {} }));
    expect(markup).toContain('role="radiogroup"');
    expect(markup.match(/type="radio"/g)).toHaveLength(5);
    expect(markup).toMatch(/checked="" value="0"/);
    expect(markup).toContain('aria-label="1 — совершенно неверно"');
    expect(markup).toContain('aria-label="5 — совершенно верно"');
  });
  it("explains every score, including the middle answer", () => {
    const markup = renderToStaticMarkup(React.createElement(AnswerScaleGuide));
    for (const point of ANSWER_SCALE) expect(markup).toContain(point.label);
  });
});
