import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ values: [] as unknown[], index: 0, busy: { current: false } }));
vi.mock("react", async original => ({
  ...await original<typeof import("react")>(),
  useRef: () => state.busy,
  useState: (initial: unknown) => {
    const index = state.index++;
    if (!(index in state.values)) state.values[index] = initial;
    return [state.values[index], (next: unknown) => { state.values[index] = next; }];
  },
}));
import { PdfDownloadButton } from "@/features/pdf/pdf-download-button";
function render(team = false) {
  state.index = 0;
  return PdfDownloadButton({ reportId: "existing-report", team });
}

describe("one-click PDF download", () => {
  const fetchMock = vi.fn();
  const link = { href: "", download: "", click: vi.fn() };
  beforeEach(() => {
    state.values = []; state.index = 0; state.busy.current = false;
    fetchMock.mockReset(); link.click.mockReset(); link.href = ""; link.download = "";
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("document", { createElement: () => link });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:pdf");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("does nothing on viewing and reuses an existing PDF without preparation", async () => {
    fetchMock.mockResolvedValue(new Response("%PDF-existing", { headers: { "content-disposition": 'attachment; filename="audit.pdf"' } }));
    const view = render();
    expect(fetchMock).not.toHaveBeenCalled();
    view.props.children[0].props.onClick();
    await vi.waitFor(() => expect(link.click).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/reports/existing-report/pdf", { cache: "no-store" });
    expect(link.download).toBe("audit.pdf");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:pdf");
  });

  it.each([false, true])("prepares a missing PDF and downloads it from the same click (team=%s)", async team => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 409 }));
    fetchMock.mockResolvedValueOnce(new Response('{"status":"ready"}'));
    fetchMock.mockResolvedValueOnce(new Response("%PDF-prepared"));
    const view = render(team);
    view.props.children[0].props.onClick();
    view.props.children[0].props.onClick();
    await vi.waitFor(() => expect(link.click).toHaveBeenCalledOnce());
    const base = `/api/${team ? "team-reports" : "reports"}/existing-report/pdf`;
    expect(fetchMock.mock.calls).toEqual([
      [base, { cache: "no-store" }],
      [`${base}/prepare`, { method: "POST", cache: "no-store" }],
      [base, { cache: "no-store" }],
    ]);
    expect(render(team).props.children[1]).toBeNull();
    expect(render(team).props.children[0].props.disabled).toBe(false);
  });

  it.each([
    [409, "Отчёт ещё не готов. Попробуйте скачать PDF немного позже."],
    [429, "Слишком много запросов. Попробуйте скачать PDF позже."],
    [500, "Не удалось подготовить PDF. Попробуйте ещё раз."],
  ])("stops on preparation failure %s and permits retry", async (status, message) => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 409 }));
    fetchMock.mockResolvedValueOnce(new Response("{}", { status }));
    render().props.children[0].props.onClick();
    await vi.waitFor(() => expect(render().props.children[0].props.disabled).toBe(false));
    expect(render().props.children[1].props.children).toBe(message);
    expect(link.click).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mockResolvedValueOnce(new Response("%PDF-now-ready"));
    render().props.children[0].props.onClick();
    await vi.waitFor(() => expect(link.click).toHaveBeenCalledOnce());
  });

  it("does not prepare or download after access is denied", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 403 }));
    render().props.children[0].props.onClick();
    await vi.waitFor(() => expect(render().props.children[0].props.disabled).toBe(false));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(link.click).not.toHaveBeenCalled();
  });
});
