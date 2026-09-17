import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { selectCurrentPublishedVersion } from "@/server/diagnostic/service";

const manageability = "manageability-definition";
const otherDefinition = "other-definition";

describe("diagnostic methodology version selection", () => {
  it("selects the newest published version for the manageability definition", () => {
    const selected = selectCurrentPublishedVersion([
      { id: "ru-1", definition_id: manageability, version_number: 1, status: "published" },
      { id: "ru-2", definition_id: manageability, version_number: 2, status: "published" },
      { id: "draft", definition_id: manageability, version_number: 3, status: "draft" },
      { id: "other-9", definition_id: otherDefinition, version_number: 9, status: "published" },
    ], manageability);

    expect(selected?.id).toBe("ru-2");
  });

  it("does not reinterpret historical diagnostics when selecting a new version", () => {
    const historical = { id: "diagnostic-ru-1", version_id: "ru-1" };
    const selected = selectCurrentPublishedVersion([
      { id: "ru-1", definition_id: manageability, version_number: 1, status: "published" },
      { id: "ru-2", definition_id: manageability, version_number: 2, status: "published" },
    ], manageability);

    expect(historical.version_id).toBe("ru-1");
    expect(selected?.id).toBe("ru-2");
  });
});
