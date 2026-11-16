import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ from: vi.fn(), select: vi.fn(), retry: vi.fn(), abortSignal: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/server/supabase/server", () => ({ createAuthClient: async () => ({ from: mocks.from }) }));

import { registrationPolicy } from "@/server/auth/legal";

const pointers = [
  { kind: "data_processing", version: "data-processing-v1", is_temporary: false },
  { kind: "marketing", version: "marketing-v1", is_temporary: false },
];
const documents = [
  { kind: "data_processing", version: "data-processing-v1", policy_version: "policy-v1" },
  { kind: "marketing", version: "marketing-v1", policy_version: "policy-v1" },
  { kind: "policy", version: "policy-v1", policy_version: null },
];

beforeEach(() => {
  vi.resetAllMocks();
  mocks.from.mockReturnValue({ select: mocks.select });
  mocks.select.mockReturnValue({ retry: mocks.retry });
  mocks.retry.mockReturnValue({ abortSignal: mocks.abortSignal });
});

describe("registration consent reads", () => {
  it("retries a temporary gateway error and reads the published consent versions", async () => {
    mocks.abortSignal
      .mockResolvedValueOnce({ data: null, error: { message: "Internal server error." }, status: 555 })
      .mockResolvedValueOnce({ data: pointers, error: null, status: 200 })
      .mockResolvedValueOnce({ data: documents, error: null, status: 200 });

    await expect(registrationPolicy()).resolves.toMatchObject({
      temporary: false,
      versions: { data_processing: "data-processing-v1", marketing: "marketing-v1" },
      policyUrl: "/ru/legal/privacy/policy-v1",
    });
    expect(mocks.from.mock.calls).toEqual([["consent_documents"], ["consent_documents"], ["privacy_legal_documents"]]);
    expect(mocks.retry.mock.calls).toEqual([[false], [false], [false]]);
    const [first, second] = mocks.abortSignal.mock.calls.map(([signal]) => signal);
    expect(first).toBeInstanceOf(AbortSignal);
    expect(second).not.toBe(first);
  });

  it("does not retry forbidden access or substitute another consent version", async () => {
    mocks.abortSignal.mockResolvedValue({ data: null, error: { code: "42501" }, status: 403 });

    await expect(registrationPolicy()).rejects.toThrow("Registration policy unavailable");
    expect(mocks.from.mock.calls).toEqual([["consent_documents"]]);
  });
});
