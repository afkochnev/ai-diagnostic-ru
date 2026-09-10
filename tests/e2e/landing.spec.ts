import { expect, test } from "@playwright/test";

test("Russian landing, both CTAs, registration entry and responsive layout", async ({ page }, testInfo) => {
  const externalRequests: string[] = [];
  const pageErrors: string[] = [];
  page.on("request", (request) => {
    if (!request.url().startsWith("http://127.0.0.1:3000")) externalRequests.push(request.url());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("/");
  await expect(page).toHaveURL("/ru");
  await expect(page.locator("html")).toHaveAttribute("lang", "ru");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Определите уровень управления вашей компании и ограничения для её роста.");
  for (const name of ["Что я получу?", "Что оценивается?", "Как это работает?"]) {
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  }
  await expect(page.locator("#benefits h3")).toHaveCount(4);
  await expect(page.locator("#steps li")).toHaveCount(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("landing.png"), fullPage: true });
  const ctas = page.getByRole("link", { name: "Перейти к диагностике" });
  await expect(ctas).toHaveCount(2);
  for (let index = 0; index < 2; index++) {
    await ctas.nth(index).click();
    await expect(page).toHaveURL("/ru/register");
    await expect(page.getByRole("heading", { name: "Регистрация", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Зарегистрироваться", exact: true })).toBeVisible();
    await expect(page.getByLabel("Имя", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`registration-${index}.png`), fullPage: true });
    await page.getByRole("link", { name: "Управленческий AI-аудит компании", exact: true }).click();
    await expect(page).toHaveURL("/ru");
  }
  expect(externalRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test("direct entry, keyboard navigation and localized missing pages", async ({ page }) => {
  await page.goto("/ru/register");
  await expect(page.getByRole("heading", { name: "Регистрация", exact: true })).toBeVisible();
  await page.goto("/ru");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Перейти к содержимому" })).toBeFocused();
  for (let index = 0; index < 8; index++) {
    await page.keyboard.press("Tab");
    if (await page.getByRole("link", { name: "Перейти к диагностике" }).first().evaluate((element) => element === document.activeElement)) break;
  }
  await expect(page.getByRole("link", { name: "Перейти к диагностике" }).first()).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL("/ru/register");
  for (const path of ["/ru/missing", "/en"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: "Страница не найдена" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "ru");
  }
});
