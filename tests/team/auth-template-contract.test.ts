import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {describe,it,expect} from "vitest";
const hash=(value:string)=>createHash("sha256").update(value).digest("hex");
// Removing only the new Individual dispatch must recover the exact retained template.
const legacyTemplate=(template:string)=>template
 .replace(/^\{\{ \$en[^\n]+ \}\}\n\{\{ \$ru[^\n]+ \}\}\n/, "")
 .replace(/\n\{\{ else if \$en \}\}\n[\s\S]+?\n\{\{ else if \$ru \}\}\n[\s\S]+?(?=\n\{\{ else if (?:eq|or) )/, "");
const branches=(template:string)=>{
 const controls=[...template.matchAll(/^\{\{ (if [^\n]+|else if [^\n]+|else|end) \}\}\n/gm)];
 return controls.slice(0,-1).map((control,i)=>({condition:control[1],body:template.slice(control.index!+control[0].length,controls[i+1].index).replace(/\n$/,"" )}));
};

describe("Team-scoped Auth template and callback contract",()=>{
 it.each([["signup","d81574ce27cd2cc4521a34bcbf512b52f5bbf77400e437eb0c32cba19620f9b3","Подтвердить email и начать диагностику"],["magic","6666f638fd945266ac2ac3a9ee2fc785ee439d00270efa6e6cf5a67fec985757","Продолжить командную диагностику"]])("%s separates Team/general links and preserves the exact fallback",(name,before,cta)=>{
  const template=legacyTemplate(readFileSync(`supabase/templates/team-${name}.staging.html`,"utf8"));
  const match=template.match(/^\{\{ if eq \.RedirectTo "https:\/\/ai-diagnostic-staging-web\.onrender\.com\/ru\/team\/confirm" \}\}\n([\s\S]+?)\n\{\{ else if eq \.RedirectTo "https:\/\/ai-diagnostic-staging-web\.onrender\.com\/auth\/confirm" \}\}\n([\s\S]+?)\n\{\{ else \}\}\n([\s\S]+)\n\{\{ end \}\}\n$/)!;
  expect(match).not.toBeNull();expect(hash(match[3])).toBe(before);
  expect(match[1]).toContain('href="{{ .RedirectTo }}#token_hash={{ .TokenHash }}&amp;type=email"');
  expect(match[1]).toContain(cta);expect(match[1]).not.toContain("{{ .Token }}");
  expect(match[1]).not.toMatch(/введите код|код подтверждения|одноразовый код/i);
  expect(match[1]).not.toContain("?token");expect(match[1]).not.toContain("participantId");expect(match[1]).not.toContain("invitation=");
  expect(match[2]).toContain(`href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=${name==="signup"?"signup":"email"}"`);
  expect(match[2]).not.toContain("командн");expect(match[2]).not.toContain("{{ .Token }}");
 });
 it.each(["signup","magic"])("%s production allows only the new and previous exact origins without changing either email flow",name=>{
  const production=legacyTemplate(readFileSync(`supabase/templates/team-${name}.production.html`,"utf8"));
  const branches=production.match(/^(\{\{ if [^\n]+ \}\})\n([\s\S]+?)\n(\{\{ else if [^\n]+ \}\})\n([\s\S]+?)\n\{\{ else \}\}\n([\s\S]+)\n\{\{ end \}\}\n$/)!;
  expect(branches).not.toBeNull();
  const exactCondition=(prefix:string,route:string)=>`{{ ${prefix} or (eq .RedirectTo "https://audit.iteamsystems.com${route}") (eq .RedirectTo "https://iteamsystems.com${route}") (eq .RedirectTo "https://audit.iteam.ru${route}") }}`;
  expect(branches[1]).toBe(exactCondition("if","/ru/team/confirm"));
  expect(branches[3]).toBe(exactCondition("else if","/auth/confirm"));
  const staging=legacyTemplate(readFileSync(`supabase/templates/team-${name}.staging.html`,"utf8"));
  const bodies=staging.match(/^\{\{ if [^\n]+ \}\}\n([\s\S]+?)\n\{\{ else if [^\n]+ \}\}\n([\s\S]+?)\n\{\{ else \}\}/)!;
  expect(branches[2]).toBe(bodies[1]);expect(branches[4]).toBe(bodies[2]);
  expect(hash(branches[5])).toBe(name==="signup"?"2fd2fcf653b909cbcb65c9272a6f51f9d18321c368a497a15a9a3a40ecb0c61d":"87cf15e18260bceffbcebbe235e1ef1cf1677442199bdf301d9d2e46f1db6782");
  expect(production).not.toContain("ai-diagnostic-staging-web");
 });
 it.each(["staging","production"])("%s gives exact Team callbacks precedence and keeps explicit Russian requests out of English metadata fallback",environment=>{
  for(const name of ["signup","magic"]){
   const template=readFileSync(`supabase/templates/team-${name}.${environment}.html`,"utf8"),parts=branches(template);
   expect(parts).toHaveLength(5);
   expect(parts[0].condition).toContain("/ru/team/confirm");
   expect(parts[0].body).toContain('href="{{ .RedirectTo }}#token_hash={{ .TokenHash }}&amp;type=email"');
   expect(parts[1].condition).toBe("else if $en");
   expect(parts[1].body).toContain(`&amp;type=${name==="signup"?"signup":"email"}&amp;locale=en`);
   expect(parts[1].body).not.toContain("{{ .Token }}");
   expect(parts[2].condition).toBe("else if $ru");expect(parts[2].body).toBe(parts[3].body);
   expect(template).toContain('{{ $ru := eq .RedirectTo (print .SiteURL "/auth/confirm?locale=ru") }}');
   const selection=template.split("\n")[0];
   expect(selection).toContain('/auth/confirm?locale=en');expect(selection).toContain('(eq .Data.locale "en")');
   // Metadata fallback is restricted to legacy Individual contexts; an unknown Team/OTP redirect retains its original fallback.
   expect(selection).toContain('(or (eq .RedirectTo "") (eq .RedirectTo .SiteURL)');
   expect(selection).not.toContain('/auth/confirm?locale=ru');expect(selection).not.toContain('/ru/team/confirm');
  }
 });
 it.each(["confirmation.html","magic-link.html"])("generic %s preserves the current Team fragment callback before the English Individual branch",name=>{
  const template=readFileSync(`supabase/templates/${name}`,"utf8");
  expect(template).toContain('{{ if eq .RedirectTo (print .SiteURL "/ru/team/confirm") }}');
  expect(template.indexOf('/ru/team/confirm')).toBeLessThan(template.indexOf('{{ else if $en }}'));
  expect(template).toContain('href="{{ .RedirectTo }}#token_hash={{ .TokenHash }}&amp;type=email"');
  expect(template.split("\n")[0]).not.toContain('/auth/confirm?locale=ru');
 });
 it("never reads Auth or invitation secrets through GET query parameters or generic next",()=>{
  const callback=readFileSync("src/features/team/email-confirm.tsx","utf8");
  expect(callback).toContain("window.location.hash");expect(callback).toContain("window.history.replaceState");expect(callback).not.toContain("searchParams");
  const actions=readFileSync("src/server/team/passwordless-actions.ts","utf8");
  expect(actions).toContain('/ru/team/confirm');expect(actions).not.toContain('auth.admin');expect(actions).not.toContain('updateUser');expect(actions).not.toContain('next=');
 });
});
