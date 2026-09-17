FROM node:26.8.1-bookworm-slim AS base

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY . .
# Build-time placeholders keep static route generation independent of runtime
# credentials. Render injects real values only when the service starts.
ENV SUPABASE_URL=https://build.invalid \
    SUPABASE_PUBLISHABLE_KEY=build-placeholder \
    APP_URL=https://build.invalid \
    AUTH_FLOW_SECRET=build-placeholder-auth-flow-secret-000000000000
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
RUN groupadd --system --gid 1001 app \
  && useradd --system --uid 1001 --gid app app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/package-lock.json ./package-lock.json
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY --from=build /app/src ./src
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/public ./public
COPY --from=build /app/AI_REPORT_PROMPT_RU_1_0.md ./AI_REPORT_PROMPT_RU_1_0.md
COPY --from=build /app/AI_REPORT_PROMPT_RU_1_1.md ./AI_REPORT_PROMPT_RU_1_1.md
COPY --from=build /app/AI_REPORT_PROMPT_RU_1_2.md ./AI_REPORT_PROMPT_RU_1_2.md
COPY --from=build /app/AI_REPORT_PROMPT_RU_1_3.md ./AI_REPORT_PROMPT_RU_1_3.md
COPY --from=build /app/AI_REPORT_SCHEMA_RU_1_0.json ./AI_REPORT_SCHEMA_RU_1_0.json
RUN npx playwright install --with-deps chromium \
  && chmod -R a+rX /ms-playwright \
  && chown -R app:app /app /ms-playwright
USER app
EXPOSE 3000
CMD ["npm", "run", "start"]
