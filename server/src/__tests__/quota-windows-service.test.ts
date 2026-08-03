import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("../adapters/registry.js", () => ({
  listServerAdapters: vi.fn(),
}));

import { listServerAdapters } from "../adapters/registry.js";
import { fetchAllQuotaWindows } from "../services/quota-windows.js";

describe("fetchAllQuotaWindows", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns adapter results without waiting for a slower provider to finish forever", async () => {
    vi.mocked(listServerAdapters).mockReturnValue([
      {
        type: "codex_local",
        getQuotaWindows: vi.fn().mockResolvedValue({
          provider: "openai",
          source: "codex-rpc",
          ok: true,
          windows: [{ label: "5h limit", usedPercent: 2, resetsAt: null, valueLabel: null, detail: null }],
        }),
      },
      {
        type: "claude_local",
        getQuotaWindows: vi.fn(() => new Promise(() => {})),
      },
    ] as never);

    const promise = fetchAllQuotaWindows();
    await vi.advanceTimersByTimeAsync(20_001);
    const results = await promise;

    expect(results).toEqual([
      {
        provider: "openai",
        source: "codex-rpc",
        ok: true,
        windows: [{ label: "5h limit", usedPercent: 2, resetsAt: null, valueLabel: null, detail: null }],
      },
      {
        provider: "anthropic",
        ok: false,
        error: "quota polling timed out after 20s",
        windows: [],
      },
    ]);
  });

  it("passes the per-adapter discovery context to the matching adapter's getQuotaWindows", async () => {
    const opencodeQuota = vi.fn().mockResolvedValue({
      provider: "opencode_server",
      source: "server",
      ok: true,
      windows: [],
    });
    const claudeQuota = vi.fn().mockResolvedValue({
      provider: "anthropic",
      ok: true,
      windows: [],
    });
    vi.mocked(listServerAdapters).mockReturnValue([
      { type: "opencode_server", getQuotaWindows: opencodeQuota },
      { type: "claude_local", getQuotaWindows: claudeQuota },
    ] as never);

    const ctx = {
      agentId: "agent-1",
      companyId: "co-1",
      adapterType: "opencode_server",
      config: { hostname: "10.0.0.5", port: 4096 },
    };
    const results = await fetchAllQuotaWindows({ opencode_server: ctx });

    expect(results).toHaveLength(2);
    expect(opencodeQuota).toHaveBeenCalledWith(ctx);
    expect(claudeQuota).toHaveBeenCalledWith(undefined);
  });

  it("calls getQuotaWindows without a context when none is provided", async () => {
    const opencodeQuota = vi.fn().mockResolvedValue({
      provider: "opencode_server",
      ok: true,
      windows: [],
    });
    vi.mocked(listServerAdapters).mockReturnValue([
      { type: "opencode_server", getQuotaWindows: opencodeQuota },
    ] as never);

    await fetchAllQuotaWindows();

    expect(opencodeQuota).toHaveBeenCalledWith(undefined);
  });
});
