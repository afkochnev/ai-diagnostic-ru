import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getIdentity: vi.fn(), createAuthClient: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/server/auth/session", () => ({ getIdentity: mocks.getIdentity }));
vi.mock("@/server/supabase/server", () => ({ createAuthClient: mocks.createAuthClient }));

import { GET as getScore, POST as postScore } from "@/app/api/diagnostics/[diagnosticId]/score/route";
import { GET as getAI, POST as postAI } from "@/app/api/diagnostics/[diagnosticId]/ai/route";

const diagnosticId = "52310f21-4163-4f0a-8d7a-547cd2a93002";
const companyId = "a0bbeca4-de19-4bce-a2dc-89baf31c9af2";
const accountId = "9ee35cf6-f607-4698-b8c1-8d15f873148a";
const userId = "1a71db58-fbfa-4f48-ae7f-6bf10c0c5038";
const reportId = "3c3eaba9-f081-4fab-aae7-8bd6409bbc9a";
type Row = Record<string, unknown> | null;
type ReadCall = {
  table: string;
  columns: string[];
  filters: Array<[string, unknown]>;
  orders: Array<[string, { ascending: boolean }]>;
  limits: number[];
};
type Query = {
  select: (columns: string) => Query;
  eq: (column: string, value: unknown) => Query;
  order: (column: string, options: { ascending: boolean }) => Query;
  limit: (count: number) => Query;
  maybeSingle: () => Promise<{ data: Row; error: null }>;
  insert: () => never;
  update: () => never;
  upsert: () => never;
  delete: () => never;
};

let rows: Record<string, Row>;
let reads: ReadCall[];
let cookieUser: { id: string; email_confirmed_at: string | null } | null;
const mutation = vi.fn(() => { throw new Error("Status reads must not mutate data"); });
const network = vi.fn(() => { throw new Error("Status tests must not contact services"); });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", network);
  reads = [];
  cookieUser = { id: userId, email_confirmed_at: "2026-09-19T00:00:00Z" };
  rows = {
    // Authority comes from current membership, not legacy creator fields.
    diagnostics: { id: diagnosticId, company_id: companyId, status: "completed", created_by_user_id: "another-user" },
    company_profiles: { id: companyId, account_id: accountId, owner_user_id: "another-user" },
    account_memberships: { account_id: accountId },
    accounts: { id: accountId, status: "active" },
    ai_reports: { id: reportId, version: 2, status: "completed", error_code: null },
  };
  mocks.getIdentity.mockResolvedValue({ user: { id: userId } });
  mocks.createAuthClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: cookieUser }, error: null }) },
    from: (table: string) => {
      if (!(table in rows)) throw new Error(`Unexpected status table: ${table}`);
      const read: ReadCall = { table, columns: [], filters: [], orders: [], limits: [] };
      reads.push(read);
      const query: Query = {
        select: (columns) => { read.columns.push(columns); return query; },
        eq: (column, value) => { read.filters.push([column, value]); return query; },
        order: (column, options) => { read.orders.push([column, options]); return query; },
        limit: (count) => { read.limits.push(count); return query; },
        maybeSingle: async () => ({ data: rows[table], error: null }),
        insert: mutation, update: mutation, upsert: mutation, delete: mutation,
      };
      return query;
    },
    rpc: mutation,
  });
});

afterEach(() => {
  expect(mutation).not.toHaveBeenCalled();
  expect(network).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

function context(id = diagnosticId) { return { params: Promise.resolve({ diagnosticId: id }) }; }
function request(method = "GET") { return new Request(`http://localhost/api/diagnostics/${diagnosticId}`, { method }); }
function expectPrivate(response: Response) { expect(response.headers.get("Cache-Control")).toBe("private, no-store"); }
const handlers = [["score", getScore], ["AI", getAI]] as const;

describe("authenticated read-only diagnostic status GET", () => {
  it.each(handlers)("denies anonymous %s reads before database access", async (_, handler) => {
    mocks.getIdentity.mockResolvedValue(null);
    const response = await handler(request(), context());
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expectPrivate(response);
    expect(mocks.createAuthClient).not.toHaveBeenCalled();
  });

  it.each(handlers)("rejects malformed %s IDs before database access", async (_, handler) => {
    const response = await handler(request(), context("not-a-uuid"));
    expect(response.status).toBe(404);
    expectPrivate(response);
    expect(mocks.createAuthClient).not.toHaveBeenCalled();
  });

  it.each(handlers)("hides foreign %s diagnostics before company/report access", async (_, handler) => {
    rows.diagnostics = null;
    const response = await handler(request(), context());
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
    expectPrivate(response);
    expect(reads).toHaveLength(1);
    expect(reads[0].filters).toEqual([["id", diagnosticId]]);
  });

  it.each(handlers)("binds %s access to the verified cookie identity", async (_, handler) => {
    cookieUser = { id: "different-user", email_confirmed_at: "2026-09-19T00:00:00Z" };
    const response = await handler(request(), context());
    expect(response.status).toBe(404);
    expectPrivate(response);
    expect(reads).toEqual([]);
  });

  it.each(handlers)("denies unverified cookie users for %s status", async (_, handler) => {
    cookieUser = { id: userId, email_confirmed_at: null };
    const response = await handler(request(), context());
    expect(response.status).toBe(404);
    expectPrivate(response);
    expect(reads).toEqual([]);
  });

  it.each(handlers)("denies revoked membership for %s status before report access", async (_, handler) => {
    rows.account_memberships = null;
    const response = await handler(request(), context());
    expect(response.status).toBe(404);
    expectPrivate(response);
    expect(reads.map((read) => read.table)).toEqual(["diagnostics", "company_profiles", "account_memberships"]);
    expect(reads[2].filters).toEqual([["account_id", accountId], ["user_id", userId], ["role", "owner"], ["status", "active"]]);
  });

  it.each(handlers)("denies archived accounts for %s status before report access", async (_, handler) => {
    rows.accounts = null;
    const response = await handler(request(), context());
    expect(response.status).toBe(404);
    expectPrivate(response);
    expect(reads.at(-1)).toMatchObject({ table: "accounts", filters: [["id", accountId], ["status", "active"]] });
    expect(reads.some((read) => read.table === "ai_reports")).toBe(false);
  });

  it.each([
    ["completed", 200, { status: "completed" }],
    ["scoring", 202, { status: "scoring" }],
    ["submitted", 202, { status: "queued" }],
    ["scoring_failed", 202, { status: "scoring_failed" }],
    ["in_progress", 409, { error: "not_ready" }],
  ] as const)("reads scoring state %s using current company membership without enqueuing work", async (status, expectedStatus, body) => {
    rows.diagnostics = { ...rows.diagnostics, status };
    const response = await getScore(request(), context());
    expect(response.status).toBe(expectedStatus);
    expect(await response.json()).toEqual(body);
    expectPrivate(response);
    expect(reads.map((read) => read.table)).toEqual(["diagnostics", "company_profiles", "account_memberships", "accounts"]);
    expect(reads[1].filters).toEqual([["id", companyId]]);
    expect(reads[2].filters).toEqual([["account_id", accountId], ["user_id", userId], ["role", "owner"], ["status", "active"]]);
  });

  it("reads a missing AI report without creating one", async () => {
    rows.ai_reports = null;
    const response = await getAI(request(), context());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "missing" });
    expectPrivate(response);
  });

  it.each(["queued", "generating", "completed", "failed"])("reads the exact diagnostic's latest AI report in state %s after membership authorization", async (status) => {
    rows.ai_reports = { id: reportId, version: 2, status, error_code: "provider_retryable" };
    const response = await getAI(request(), context());
    expect(await response.json()).toEqual({ status, report_id: reportId, version: 2, ...(status === "failed" ? { error_code: "AI_REPORT_FAILED" } : {}) });
    expectPrivate(response);
    expect(reads.map((read) => read.table)).toEqual(["diagnostics", "company_profiles", "account_memberships", "accounts", "ai_reports"]);
    expect(reads.at(-1)).toEqual({
      table: "ai_reports", columns: ["id,version,status"], filters: [["diagnostic_id", diagnosticId]],
      orders: [["version", { ascending: false }]], limits: [1],
    });
  });

  it("keeps legacy POST status clients on the same read-only handlers", async () => {
    expect(postScore).toBe(getScore);
    expect(postAI).toBe(getAI);
    const scoring = await postScore(request("POST"), context());
    const ai = await postAI(request("POST"), context());
    expect(await scoring.json()).toEqual({ status: "completed" });
    expect(await ai.json()).toEqual({ status: "completed", report_id: reportId, version: 2 });
    expectPrivate(scoring);
    expectPrivate(ai);
  });
});
