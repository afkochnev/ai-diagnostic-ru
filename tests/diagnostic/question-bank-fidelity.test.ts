import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

type Bank = { blocks: Array<{ key: string; title: string; position: number; questions: Array<{ position: number; text: string }> }> };
const csv = readFileSync("METHODOLOGY_RU_2_0.csv", "utf8");
const expected = JSON.parse(readFileSync("tests/fixtures/stage12-approved-question-bank.json", "utf8")) as Bank;

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      cells.push(cell);
      cell = "";
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  return cells;
}

function readScoringBank(): Bank["blocks"] {
  const [header, ...lines] = csv.trimEnd().split("\n");
  const columns = parseCsvLine(header);
  const index = new Map(columns.map((name, position) => [name, position]));
  const rows = lines.map(parseCsvLine).filter((row) => row[index.get("question_weight")!] === "1");
  const blocks = new Map<string, Bank["blocks"][number]>();
  for (const row of rows) {
    const key = row[index.get("block_code")!];
    const block = blocks.get(key) ?? {
      key,
      title: row[index.get("block_title")!],
      position: Number(row[index.get("block_order")!]),
      questions: [],
    };
    block.questions.push({
      position: Number(row[index.get("question_order")!]),
      text: row[index.get("question_text")!],
    });
    blocks.set(key, block);
  }
  return [...blocks.values()].sort((a, b) => a.position - b.position);
}

describe("RU-2.0 question bank fidelity", () => {
  it("matches the complete authoritative 8x10 fixture exactly", () => {
    const actual = readScoringBank();
    expect(actual).toEqual(expected.blocks);
    expect(actual).toHaveLength(8);
    expect(actual.flatMap((b) => b.questions)).toHaveLength(80);
    expect(csv).not.toContain("\\ufffe");
    expect(csv).not.toContain("￾");
    expect(csv).not.toMatch(/\w\n\w/);
  });

  it("locks the approved control wording and Block 7 title", () => {
    const b3 = expected.blocks.find((b) => b.key === "processes")!;
    const b8 = expected.blocks.find((b) => b.key === "culture")!;
    expect(b3.questions[4].text).toBe("Компания понимает финансовую и операционную эффективность на необходимом для управления уровне — по направлениям, продуктам, клиентским сегментам, заказам или процессам, там, где это существенно для принятия решений.");
    expect(b3.questions[9].text).toBe("Автоматизация эффективно применяется в ключевых процессах и позволяет существенно снизить ручной труд, количество ошибок, время выполнения операций или зависимость от отдельных сотрудников.");
    expect(b8.questions[0].text).toBe("У нас есть чётко определённые ценности, известные каждому члену коллектива, и это не просто слова — они реально влияют на поведение людей.");
    expect(expected.blocks.find((b) => b.key === "motivation")?.title).toBe("Инновации и развитие");
  });
});
