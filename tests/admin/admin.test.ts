import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const guard = readFileSync("src/server/auth/admin.ts", "utf8");
const page = readFileSync("src/app/[locale]/(admin)/admin/page.tsx", "utf8");
const shell = readFileSync("src/features/admin/admin-shell.tsx", "utf8");
const actions = readFileSync("src/server/auth/actions.ts", "utf8");
const mfaPage = readFileSync("src/app/[locale]/(auth)/mfa/page.tsx", "utf8");

describe("Stage 8A admin boundary", () => {
  it("centralizes verified identity, MFA and administrator role checks", () => {
    expect(guard).toContain("requireIdentity");
    expect(guard).toContain('identity.role !== "administrator"');
    expect(guard).toContain("/ru/access-denied");
  });

  it("does not query business data in the shell", () => {
    expect(page).toContain("requireAdmin");
    expect(page).not.toContain("createAdminClient");
    expect(shell).not.toContain("createAdminClient");
    expect(shell).not.toContain("diagnostic_results");
  });

  it("renders only the planned disabled Russian sections", () => {
    for (const label of ["Диагностики", "Компании и пользователи", "Заявки на консультацию", "Обратная связь", "Метрики"]) {
      expect(shell).toContain(label);
    }
    expect(shell).toContain("Раздел будет доступен на следующем этапе разработки.");
    expect(shell).toContain("Администрирование");
  });

  it("routes an administrator to the admin shell after aal2", () => {
    expect(actions).toContain('redirect(role?.role === "administrator" ? "/ru/admin" : "/ru/company-profile")');
    expect(mfaPage).toContain('redirect(identity.role === "administrator" ? "/ru/admin" : "/ru/account")');
  });

  it("keeps the admin route behind the shared guard", () => {
    expect(page).toContain("await requireAdmin()");
    expect(guard).toContain('identity.role !== "administrator"');
    const session = readFileSync("src/server/auth/session.ts", "utf8");
    expect(session).toContain('identity.role === "administrator" && identity.aal !== "aal2"');
  });
});
