import { test, expect, type APIRequestContext } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

test.describe.configure({ mode: "serial" });
test.beforeAll(() => {
  if (process.env.SUPABASE_URL !== "http://127.0.0.1:54321") throw new Error("Auth E2E requires isolated local Supabase");
});

async function emailLink(request: APIRequestContext, email: string, subject: string) {
  let id: string | undefined;
  await expect.poll(async () => {
    const response = await request.get("http://127.0.0.1:54324/api/v1/messages");
    const data = await response.json() as { messages: { ID: string; Subject: string; To: { Address: string }[] }[] };
    id = data.messages.find((mail) => mail.Subject === subject && mail.To.some((to) => to.Address === email))?.ID;
    return Boolean(id);
  }, { timeout: 20000 }).toBe(true);
  const message = await (await request.get(`http://127.0.0.1:54324/api/v1/message/${id}`)).json() as { HTML: string };
  const link = message.HTML.match(/href="([^"]+)"/)?.[1]?.replaceAll("&amp;", "&");
  if (!link?.startsWith("http://127.0.0.1:3000/auth/confirm?")) throw new Error("Unexpected local email link");
  return link;
}

test("registration, verification, login, password recovery, logout and role isolation", async ({ page, request }, testInfo) => {
  test.setTimeout(120000);
  const email = `stage2-${randomUUID()}@example.test`;
  const password = "onlylowercasepassword";
  await page.goto("/ru/company-profile");
  await expect(page).toHaveURL("/ru/login");
  await page.goto("/ru/admin");
  await expect(page).toHaveURL("/ru/login");
  await page.goto("/ru/register");
  await page.getByLabel("Имя", { exact: true }).fill("Тестовый пользователь");
  await page.locator('input[name="email"]:visible').first().fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('input[name="confirm_password"]').fill(password);
  await page.getByRole("button", { name: "Зарегистрироваться", exact: true }).click();
  await expect(page.locator('p[role="alert"]')).toContainText("подтвердите согласие");
  await page.getByLabel("Я согласен с политикой обработки персональных данных.", { exact: true }).check();
  await page.getByRole("button", { name: "Зарегистрироваться", exact: true }).click();
  await expect(page).toHaveURL("/ru/verify-email");
  await page.screenshot({ path: testInfo.outputPath("verification.png"), fullPage: true });
  await page.goto("/ru/login");
  await page.locator('input[name="email"]:visible').first().fill(email);
  await page.locator('input[name="password"]:visible').fill(password);
  await page.getByRole("button", { name: "Вход", exact: true }).click();
  await expect(page.locator('p[role="alert"]')).toContainText("Подтвердите email");
  const confirm = await emailLink(request, email, "Подтвердите email");
  await page.goto(confirm);
  await page.getByRole("button", { name: "Подтвердить email", exact: true }).click();
  await expect(page).toHaveURL("/ru?welcome=1");
  await expect(page.getByRole("heading", { name: "Определите уровень управления вашей компании и ограничения для её роста.", exact: true })).toBeVisible();
  await page.goto("/ru/admin");
  await expect(page).toHaveURL("/ru/access-denied");
  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  await expect(page).toHaveURL("/ru/login");
  await page.goto("/ru/company-profile");
  await expect(page).toHaveURL("/ru/login");
  await page.locator('input[name="email"]:visible').first().fill(email);
  await page.locator('input[name="password"]').fill("incorrectpassword");
  await page.getByRole("button", { name: "Вход", exact: true }).click();
  await expect(page.locator('p[role="alert"]')).toHaveText("Неверный Email или пароль.");
  await page.locator('input[name="email"]:visible').first().fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "Вход", exact: true }).click();
  await expect(page).toHaveURL("/ru");
  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Создание профиля компании", exact: true })).toHaveCount(0);
  await page.goto("/ru/login");
  await page.getByRole("button", { name: "Забыли пароль?", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Email", { exact: true }).fill(email);
  await dialog.getByRole("button", { name: "Отправить ссылку", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText("Проверьте почту");
  const recovery = await emailLink(request, email, "Восстановление пароля");
  await page.goto(recovery);
  await page.getByRole("button", { name: "Продолжить восстановление", exact: true }).click();
  await expect(page).toHaveURL("/ru/reset-password");
  await page.locator('input[name="password"]').fill("newonlylowercasepassword");
  await page.getByRole("button", { name: "Сохранить пароль", exact: true }).click();
  await expect(page).toHaveURL("/ru/login?password=updated");
  await expect(page.getByRole("status")).toContainText("Пароль изменён");
  await page.goto(recovery);
  await page.getByRole("button", { name: "Продолжить восстановление", exact: true }).click();
  await expect(page.locator('p[role="alert"]')).toContainText("Ссылка недействительна");
  await page.goto("/ru/login");
  await page.locator('input[name="email"]:visible').first().fill(email);
  await page.locator('input[name="password"]').fill("newonlylowercasepassword");
  await page.getByRole("button", { name: "Вход", exact: true }).click();
  await expect(page).toHaveURL("/ru");
  expect((await page.context().cookies()).filter((cookie) => cookie.name.startsWith("sb-")).every((cookie) => cookie.httpOnly)).toBe(true);

  // The browser cannot gain privileges even by bypassing forms and using the public API.
  const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password: "newonlylowercasepassword" });
  expect(error).toBeNull();
  expect(data.user).not.toBeNull();
  expect((await client.auth.updateUser({ data: { role: "administrator", data_processing_consent: false } })).error).toBeNull();
  expect((await client.from("user_roles").update({ role: "administrator" }).eq("user_id", data.user!.id)).error).not.toBeNull();
  expect((await client.from("user_roles").select("role").single()).data?.role).toBe("user");
  const consents = (await client.from("user_consents").select("kind, granted, version, recorded_at")).data;
  expect(consents).toHaveLength(2);
  expect(consents?.find((row) => row.kind === "marketing")?.granted).toBe(false);
  expect(consents?.find((row) => row.kind === "data_processing")?.granted).toBe(true);
  await page.goto("/ru/admin");
  await expect(page).toHaveURL("/ru/access-denied");
  await page.getByRole("button", { name: "Выйти", exact: true }).click();
  expect((await client.from("user_roles").select("role").single()).data?.role).toBe("user");
});

test("direct Auth signup cannot assign administrator or bypass mandatory consent", async () => {
  const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
  const { error } = await client.auth.signUp({ email: `no-consent-${randomUUID()}@example.test`, password: "normalpassword", options: { data: { full_name: "No consent", role: "administrator" } } });
  expect(error).not.toBeNull();
});
