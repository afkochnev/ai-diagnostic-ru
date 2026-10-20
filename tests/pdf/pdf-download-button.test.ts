import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ values: [] as unknown[], index: 0 }));

vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = state.index++;
    if (!(index in state.values)) state.values[index] = initial;
    return [state.values[index], (next: unknown) => { state.values[index] = next; }];
  },
}));

import { PdfDownloadButton } from "@/features/pdf/pdf-download-button";

function render() {
  state.index = 0;
  return PdfDownloadButton({ reportId: "existing-report" });
}

describe("PDF download stays read-only", () => {
  const fetchMock = vi.fn();
  const link = { href: "", download: "", click: vi.fn() };
  const createElement = vi.fn(() => link);

  beforeEach(() => {
    state.values = [];
    state.index = 0;
    fetchMock.mockReset();
    link.href = "";
    link.download = "";
    link.click.mockClear();
    createElement.mockClear();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("document", { createElement });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:existing-pdf");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("does nothing on viewing and downloads the existing PDF with one GET", async () => {
    const blob = new Blob(["%PDF-existing"], { type: "application/pdf" });
    fetchMock.mockResolvedValue(new Response(blob, {
      headers: { "content-disposition": 'attachment; filename="existing-audit.pdf"' },
    }));

    const view = render();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(view.props.children[2]).toBe(false);
    view.props.children[0].props.onClick();
    expect(render().props.children[0].props.children).toBe("Скачиваем PDF…");
    await vi.waitFor(() => expect(link.click).toHaveBeenCalledOnce());

    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/reports/existing-report/pdf", { cache: "no-store" });
    expect(link.href).toBe("blob:existing-pdf");
    expect(link.download).toBe("existing-audit.pdf");
    expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:existing-pdf");
    expect(render().props.children[0].props.disabled).toBe(false);
  });

  it("shows a controlled not-ready message without preparing a missing artifact", async () => {
    fetchMock.mockResolvedValue(new Response('{"error":"pdf_not_ready"}', { status: 409 }));

    render().props.children[0].props.onClick();
    await vi.waitFor(() => expect(render().props.children[0].props.disabled).toBe(false));

    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/reports/existing-report/pdf", { cache: "no-store" });
    expect(createElement).not.toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(render().props.children[1].props).toMatchObject({
      role: "alert", children: "PDF ещё не готов. Нажмите «Подготовить PDF», затем скачайте его.",
    });
    expect(render().props.children[2].props.children).toBe("Подготовить PDF");
  });

  it("prepares only with a separate explicit click and waits for a separate download retry", async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"error":"pdf_not_ready"}', { status: 409 }));
    fetchMock.mockResolvedValueOnce(new Response('{"status":"ready"}'));
    fetchMock.mockResolvedValueOnce(new Response("%PDF-existing"));

    render().props.children[0].props.onClick();
    await vi.waitFor(() => expect(render().props.children[0].props.disabled).toBe(false));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    render().props.children[2].props.onClick();
    expect(render().props.children[2].props.children).toBe("Готовим PDF…");
    expect(render().props.children[0].props.disabled).toBe(true);
    await vi.waitFor(() => expect(render().props.children[0].props.disabled).toBe(false));

    expect(fetchMock.mock.calls).toEqual([
      ["/api/reports/existing-report/pdf", { cache: "no-store" }],
      ["/api/reports/existing-report/pdf/prepare", { method: "POST", cache: "no-store" }],
    ]);
    expect(link.click).not.toHaveBeenCalled();
    expect(render().props.children[2]).toBe(false);
    expect(render().props.children[3].props).toMatchObject({
      role: "status", children: "PDF готов. Нажмите «Скачать PDF».",
    });

    render().props.children[0].props.onClick();
    await vi.waitFor(() => expect(link.click).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenLastCalledWith("/api/reports/existing-report/pdf", { cache: "no-store" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it.each([
    [409, "Отчёт ещё не готов для подготовки PDF. Попробуйте позже."],
    [500, "Не удалось подготовить PDF. Попробуйте ещё раз."],
  ])("keeps an explicit preparation retry available after response %s", async (status, message) => {
    fetchMock.mockResolvedValueOnce(new Response('{"error":"pdf_not_ready"}', { status: 409 }));
    fetchMock.mockResolvedValueOnce(new Response("{}", { status }));

    render().props.children[0].props.onClick();
    await vi.waitFor(() => expect(render().props.children[0].props.disabled).toBe(false));
    render().props.children[2].props.onClick();
    await vi.waitFor(() => expect(render().props.children[2].props.disabled).toBe(false));

    expect(render().props.children[1].props.children).toBe(message);
    expect(render().props.children[2].props.children).toBe("Подготовить PDF");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(link.click).not.toHaveBeenCalled();
  });

  it("reports a failed download and permits a read-only retry", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network unavailable"));
    fetchMock.mockResolvedValueOnce(new Response("%PDF-existing", { headers: { "content-type": "application/pdf" } }));

    render().props.children[0].props.onClick();
    await vi.waitFor(() => expect(render().props.children[0].props.disabled).toBe(false));
    expect(render().props.children[1].props.children).toBe("Не удалось скачать PDF. Попробуйте ещё раз.");

    render().props.children[0].props.onClick();
    expect(render().props.children[1]).toBeNull();
    await vi.waitFor(() => expect(link.click).toHaveBeenCalledOnce());

    expect(link.download).toBe("management-ai-audit.pdf");
    expect(fetchMock.mock.calls).toEqual([
      ["/api/reports/existing-report/pdf", { cache: "no-store" }],
      ["/api/reports/existing-report/pdf", { cache: "no-store" }],
    ]);
  });
});
