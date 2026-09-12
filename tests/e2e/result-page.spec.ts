import { test, expect } from "@playwright/test";

test("result route remains protected and does not generate PDF on page load", async ({ page }) => {
  let pdfRequests = 0;
  page.on("request", (request) => {
    if (request.url().includes("/api/reports/") && request.url().endsWith("/pdf")) pdfRequests += 1;
  });
  await page.goto("/ru/diagnostics/9152284d-1974-4a60-a80f-2adee6bf6fd5/result");
  await expect(page).toHaveURL(/\/ru\/login/);
  expect(pdfRequests).toBe(0);
});

test("consultation API denies unauthenticated requests", async ({ request }) => {
  const response = await request.post("/api/lead-requests", { data: { diagnostic_id: "9152284d-1974-4a60-a80f-2adee6bf6fd5", report_id: "3c3eaba9-f081-4fab-aae7-8bd6409bbc9a", name: "Иван Петров", idempotency_key: "11111111-1111-4111-8111-111111111111" } });
  expect(response.ok()).toBe(false);
});

test("internal consultation worker is not public", async ({ request }) => {
  const response = await request.post("/api/internal/workers/consultation");
  expect(response.status()).toBe(404);
});

test("feedback API denies unauthenticated requests", async ({ request }) => {
  const response = await request.post("/api/feedback", { data: { diagnostic_id: "9152284d-1974-4a60-a80f-2adee6bf6fd5", rating: 5 } });
  expect(response.ok()).toBe(false);
});
