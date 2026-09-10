# Company Manageability AI Diagnostic

Stages 1–2: Russian public landing plus Supabase-backed identity, consent and protected navigation. Company profile, diagnostics, OpenAI, PDF, background jobs and admin UI are not connected.

## Run locally

Use a current Node.js version compatible with the pinned dependencies (verified with Node 26.8.1 and npm 11.19.0).

```sh
npm ci
npm run dev
```

Copy `.env.example` to `.env.local`, start Supabase with `npx supabase start`, then open http://127.0.0.1:3000/ru. `/` redirects to `/ru`. Both landing CTAs lead to `/ru/register`. Use the local Mailpit UI at http://127.0.0.1:54324 to inspect confirmation and recovery emails. Without `.env.local`, the public landing still works and auth pages show a safe unavailable state.

## Checks

```sh
npm run typecheck
npm run lint
npm run build
npm run test:e2e
npx supabase test db
```

The browser tests use installed Google Chrome and start the production server automatically if port 3000 is available. Run `npx playwright install chrome` if Chrome is missing. Use `npm run start` to keep the production build running for manual inspection. Screenshot artifacts are written under ignored `test-results/`.

ESLint 9 is pinned because the React plugin supplied by the current Next.js ESLint configuration fails under ESLint 10. Reassess this tooling constraint when the upstream plugin supports ESLint 10. Application dependencies are pinned with a committed-ready npm lockfile.

Development and production builds use the supported Webpack mode. Turbopack's PostCSS subprocess could not bind its internal port in this execution environment, including after an escalation attempt; Webpack passed the production build. This does not change App Router or Tailwind usage.

## Structure and localization

- `src/app/[locale]/(public)`: landing route.
- `src/app/[locale]/(auth)/register`: visual registration entry only.
- `src/features/landing`: page sections and header.
- `src/components/ui`: shared container, card and button-link primitives.
- `src/messages/ru.json`: all user-facing copy; landing text follows PRODUCT_SPEC §4 verbatim.
- `src/i18n`: supported locale validation, typed dictionaries and locale path generation. Only `ru` is enabled; unsupported locale routes show the Russian 404. When adding another language, add its dictionary and move the document shell into the locale layout so `html.lang` follows the route.

The system Arial/Helvetica/sans-serif stack requires no font download. The header reserves an empty, non-interactive logo slot; no imitation iTeam image is shipped. Official branding is pending the asset identified in D12. Unneeded future-stage directories are intentionally not scaffolded.

Stage 2 environment and verification details are in [docs/stage-2-verification.md](docs/stage-2-verification.md). Do not use a service-role key in `.env.local`; the application accepts only the Supabase publishable key.

## Implementation references

Framework setup follows the official [Next.js installation guide](https://nextjs.org/docs/app/getting-started/installation) and [Tailwind Next.js guide](https://tailwindcss.com/docs/installation/framework-guides/nextjs). Product and architecture authority remains with `PRODUCT_SPEC.md` and `ARCHITECTURE.md`.
