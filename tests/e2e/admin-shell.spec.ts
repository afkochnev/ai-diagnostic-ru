import { test, expect } from "@playwright/test";

test("unauthenticated admin route does not expose the shell", async ({ page }) => {
  await page.goto("/ru/admin");
  await expect(page).toHaveURL(/\/ru\/login/);
  await expect(page.getByRole("heading", { name: "Администрирование", exact: true })).toHaveCount(0);
});

test("role query spoofing does not grant admin access", async ({ page }) => {
  await page.goto("/ru/admin?role=administrator&is_admin=true&admin=true");
  await expect(page).toHaveURL(/\/ru\/login/);
  await expect(page.getByRole("heading", { name: "Администрирование", exact: true })).toHaveCount(0);
});
