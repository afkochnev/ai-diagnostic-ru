import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

test.describe.configure({ mode: "serial" });

async function confirmationLink(request: APIRequestContext, email: string) {
  let id: string | undefined;
  await expect.poll(async () => {
    const response = await request.get("http://127.0.0.1:54324/api/v1/messages");
    const data = await response.json() as { messages: { ID: string; Subject: string; To: { Address: string }[] }[] };
    id = data.messages.find((mail) => mail.Subject === "Подтвердите email" && mail.To.some((to) => to.Address === email))?.ID;
    return Boolean(id);
  }, { timeout: 20000 }).toBe(true);
  const message = await (await request.get(`http://127.0.0.1:54324/api/v1/message/${id}`)).json() as { HTML: string };
  const link = message.HTML.match(/href="([^"]+)"/)?.[1]?.replaceAll("&amp;", "&");
  if (!link) throw new Error("Confirmation link not found");
  return link;
}

async function fillProfile(page: Page, suffix: string) {
  await page.locator('input[name="name"]').fill(`ООО «Тест ${suffix}»`);
  await page.locator('select[name="industry_key"]').selectOption({ label: "IT / разработка ПО" });
  await page.locator('input[name="country"]').fill("Россия");
  await page.locator('textarea[name="products"]').fill("B2B SaaS платформа");
  await page.locator('textarea[name="customer_segments"]').fill("Средний бизнес");
  await page.locator('textarea[name="sales_channels"]').fill("Прямые продажи");
  await page.locator('input[name="employee_count"]').fill("24");
  await page.locator('select[name="annual_revenue_key"]').selectOption({ label: "10–100 млн руб." });
  await page.locator('input[name="company_age_years"]').fill("6");
  await page.locator('input[name="management_levels"]').fill("3");
  await page.locator('textarea[name="key_problems"]').fill("Рост без единых процессов");
  await page.locator('textarea[name="main_goals"]').fill("Улучшить управляемость");
}

test("profile lifecycle, dashboard, edit, validation, ownership and idempotent save", async ({ page, request }) => {
  test.setTimeout(120000);
  await page.addInitScript(() => {
    class SpeechRecognitionStub {
      onstart: (() => void) | null = null;
      onend: (() => void) | null = null;
      onresult: ((event: { results: unknown[] }) => void) | null = null;

      start() { this.onstart?.(); }
      stop() {
        this.onresult?.({ results: [Object.assign([{ transcript: "Распознанная фраза." }], { isFinal: true })] });
        this.onend?.();
      }
      abort() {}
    }

    Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: SpeechRecognitionStub });
    Object.defineProperty(window, "AudioWorkletNode", { configurable: true, value: undefined });
  });
  const email = `stage3-${randomUUID()}@example.test`;
  const password = "stage3-password";
  await page.goto("/ru/register");
  await page.getByLabel("Имя", { exact: true }).fill("Пользователь Stage 3");
  await page.locator('input[name="email"]:visible').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('input[name="confirm_password"]').fill(password);
  await page.getByLabel("Я согласен с политикой обработки персональных данных.", { exact: true }).check();
  await page.getByRole("button", { name: "Зарегистрироваться", exact: true }).click();
  await expect(page).toHaveURL("/ru/verify-email");
  await page.goto(await confirmationLink(request, email));
  await page.getByRole("button", { name: "Подтвердить email", exact: true }).click();
  await expect(page).toHaveURL("/ru/company-profile");

  await page.getByRole("button", { name: "Сохранить и перейти в кабинет", exact: true }).click();
  await expect(page.locator('p[role="alert"]')).toContainText("Проверьте обязательные поля");
  await fillProfile(page, "A");
  await page.getByRole("button", { name: "Сохранить и перейти в кабинет", exact: true }).click();
  await expect(page).toHaveURL("/ru/dashboard");
  await expect(page.getByRole("heading", { name: "ООО «Тест A»", exact: true })).toBeVisible();
  await expect(page.getByText("Диагностик пока нет.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Новая диагностика", exact: true })).toBeEnabled();

  await page.getByRole("link", { name: "Редактировать профиль", exact: true }).click();
  await expect(page).toHaveURL(/\/ru\/company-profile\?returnTo=\/ru\/dashboard/);
  await page.locator('input[name="name"]').fill("ООО «Тест B»");
  await page.getByRole("button", { name: "Сохранить и перейти в кабинет", exact: true }).click();
  await expect(page).toHaveURL("/ru/dashboard");
  await expect(page.getByRole("heading", { name: "ООО «Тест B»", exact: true })).toBeVisible();

  await page.goto("/ru/company-profile");
  await page.locator('input[name="name"]').fill("");
  await page.getByRole("button", { name: "Сохранить и перейти в кабинет", exact: true }).click();
  await expect(page.locator('p[role="alert"]')).toContainText("Проверьте обязательные поля");
  await expect(page.getByText("Заполните это поле.", { exact: true })).toBeVisible();

  await page.goto("/ru/companies/00000000-0000-4000-8000-000000000099");
  await expect(page).toHaveURL("/ru/access-denied");
  await page.goto("/ru/dashboard");
  await page.getByRole("link", { name: "Редактировать профиль", exact: true }).click();
  await page.locator('input[name="name"]').fill("ООО «Тест C»");
  await page.getByRole("button", { name: "Сохранить и перейти в кабинет", exact: true }).click();
  await expect(page).toHaveURL("/ru/dashboard");
  await expect(page.getByRole("heading", { name: "ООО «Тест C»", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  await page.goto("/ru/login");
  await page.locator('input[name="email"]:visible').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "Вход", exact: true }).click();
  await expect(page).toHaveURL("/ru/dashboard");
  await expect(page.getByRole("heading", { name: "ООО «Тест C»", exact: true })).toBeVisible();
  const apiStart = await page.request.post("/api/diagnostics");
  expect([200, 201]).toContain(apiStart.status());
  const apiDiagnostic = await apiStart.json() as { id: string };
  expect(apiDiagnostic.id).toMatch(/^[0-9a-f-]{36}$/);
  await expect(page.getByRole("button", { name: "Новая диагностика", exact: true })).toBeDisabled();
  await expect(page).toHaveURL("/ru/dashboard");
  await expect(page.getByRole("heading", { name: "Общая информация", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await expect(page.getByText(/потребуется 30–40 минут/)).toBeVisible();
  const original = "Согласовать ответственность за ключевые решения.";
  const firstQuestion = page.locator("article").first();
  const answer = firstQuestion.locator("textarea").first();
  await answer.fill(original);
  const microphone = firstQuestion.getByRole("button", { name: "Диктовать ответ" });
  await microphone.focus();
  await expect(microphone).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(firstQuestion.getByText("Микрофон включён — можно говорить.")).toBeVisible();
  const dictationHint = firstQuestion.getByRole("region", { name: "Подсказка по диктовке" });
  await expect(dictationHint).toContainText("Произносите слова отчетливо и раздельно. После завершения диктовки не забудьте сохранить текст");
  await firstQuestion.getByRole("button", { name: "Закрыть подсказку по диктовке" }).click();
  await expect(dictationHint).toHaveCount(0);
  await expect(firstQuestion.getByRole("button", { name: "Остановить диктовку" })).toBeVisible();
  await firstQuestion.getByRole("button", { name: "Отменить" }).click();
  await expect(answer).toHaveValue(original);

  await microphone.click();
  await expect(dictationHint).toBeVisible();
  await firstQuestion.getByRole("button", { name: "Остановить диктовку" }).click();
  const recognized = firstQuestion.getByLabel("Распознанный текст");
  await expect(recognized).toHaveValue("Распознанная фраза.");
  await expect(answer).toHaveValue(original);
  const correction = "Уточнить сроки.";
  await recognized.fill(correction);
  const inserted = page.waitForResponse(
    (response) => response.request().method() === "PATCH" && response.url().endsWith("/answers")
      && Boolean(response.request().postData()?.includes(correction)) && response.ok(),
  );
  await firstQuestion.getByRole("button", { name: "Добавить к ответу" }).click();
  await expect(dictationHint).toHaveCount(0);
  await expect(answer).toHaveValue(`${original} ${correction}`);
  await inserted;
  await page.reload();
  await expect(answer).toHaveValue(`${original} ${correction}`);
  await page.locator("textarea").nth(1).fill("Ускорить рост без потери управляемости.");
  await microphone.click();
  await expect(firstQuestion.getByText("Микрофон включён — можно говорить.")).toBeVisible();
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Стратегия", exact: true })).toBeVisible();
  await expect(page.getByText("Микрофон включён — можно говорить.")).toHaveCount(0);
  await page.locator("article").nth(0).getByRole("button", { name: "5", exact: true }).click();
  await page.locator("article").nth(1).getByRole("button", { name: "4", exact: true }).click();
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Организационная структура", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Назад", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Стратегия", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "В кабинет", exact: true }).first().click();
  await expect(page).toHaveURL("/ru/dashboard");
  await expect(page.getByRole("link", { name: "Продолжить диагностику", exact: true })).toBeVisible();
  const disabledNewDiagnostic = page.getByRole("button", { name: "Новая диагностика", exact: true });
  await expect(disabledNewDiagnostic).toBeDisabled();
  await disabledNewDiagnostic.press("Enter");
  await disabledNewDiagnostic.press("Space");
  await expect(page).toHaveURL("/ru/dashboard");
  await page.goto("/ru/dashboard");
  await page.goto(await page.getByRole("link", { name: "Продолжить диагностику", exact: true }).getAttribute("href") ?? "");
  await expect(page.getByRole("heading", { name: "Стратегия", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  await page.goto("/ru/login");
  await page.locator('input[name="email"]:visible').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "Вход", exact: true }).click();
  await expect(page).toHaveURL("/ru/dashboard");
  await page.goto(await page.getByRole("link", { name: "Продолжить диагностику", exact: true }).getAttribute("href") ?? "");
  await expect(page.getByRole("heading", { name: "Стратегия", exact: true })).toBeVisible();
});
