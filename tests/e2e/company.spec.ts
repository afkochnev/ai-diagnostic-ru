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
  await expect(page.getByText("Вы ещё не проходили диагностику.", { exact: true })).toBeVisible();
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
  await page.locator("textarea").nth(0).fill("Согласовать ответственность за ключевые решения.");
  await page.locator("textarea").nth(1).fill("Ускорить рост без потери управляемости.");
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Стратегия", exact: true })).toBeVisible();
  await page.locator("article").nth(0).getByRole("button", { name: "5", exact: true }).click();
  await page.locator("article").nth(1).getByRole("button", { name: "4", exact: true }).click();
  await page.getByRole("button", { name: "Далее", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Организационная структура", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Назад", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Стратегия", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "В кабинет", exact: true }).first().click();
  await expect(page).toHaveURL("/ru/dashboard");
  await expect(page.getByRole("link", { name: "Продолжить диагностику", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Новая диагностика", exact: true }).click();
  await expect(page).toHaveURL(/\/ru\/diagnostics\/[0-9a-f-]+$/);
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
