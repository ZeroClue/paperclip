import { describe, expect, it } from "vitest";
import {
  ACTIVE_RUN_OUTPUT_CRITICAL_THRESHOLD_MS,
  ACTIVE_RUN_OUTPUT_SUSPICION_THRESHOLD_MS,
  OUTPUT_SILENCE_MIN_SUSPICION_MS,
  OUTPUT_SILENCE_TIMEOUT_SCALED_SUSPICION_CAP_MS,
  agentConfiguredTimeoutSec,
  resolveRunOutputSilenceThresholds,
} from "../services/recovery/output-silence-thresholds.ts";

describe("resolveRunOutputSilenceThresholds", () => {
  it("keeps the legacy fixed windows when no finite timeout is configured", () => {
    for (const timeoutSec of [undefined, null, 0, -1, Number.NaN]) {
      expect(resolveRunOutputSilenceThresholds(timeoutSec)).toEqual({
        suspicionThresholdMs: ACTIVE_RUN_OUTPUT_SUSPICION_THRESHOLD_MS,
        criticalThresholdMs: ACTIVE_RUN_OUTPUT_CRITICAL_THRESHOLD_MS,
      });
    }
  });

  it("scales suspicion below the adapter timeout so silence surfaces inside the budget", () => {
    // COO-754 RCA case: timeoutSec=3600 with legacy thresholds meant suspicion
    // (60min) could never fire before the timeout killed the run.
    const oneHour = resolveRunOutputSilenceThresholds(3600);
    expect(oneHour.suspicionThresholdMs).toBe(OUTPUT_SILENCE_TIMEOUT_SCALED_SUSPICION_CAP_MS);
    expect(oneHour.criticalThresholdMs).toBe(40 * 60 * 1000);
    expect(oneHour.criticalThresholdMs).toBeLessThan(3600 * 1000);

    const fourHours = resolveRunOutputSilenceThresholds(14_400);
    expect(fourHours.suspicionThresholdMs).toBe(OUTPUT_SILENCE_TIMEOUT_SCALED_SUSPICION_CAP_MS);
    expect(fourHours.criticalThresholdMs).toBe(40 * 60 * 1000);
  });

  it("caps suspicion at the configured cap and floors it for very short budgets", () => {
    // 45min budget: T/3 = 15min > cap -> suspicion capped at 10min.
    expect(resolveRunOutputSilenceThresholds(2700).suspicionThresholdMs)
      .toBe(OUTPUT_SILENCE_TIMEOUT_SCALED_SUSPICION_CAP_MS);
    // 12min budget: T/3 = 4min < floor -> suspicion floored at 5min (< budget).
    expect(resolveRunOutputSilenceThresholds(720).suspicionThresholdMs)
      .toBe(OUTPUT_SILENCE_MIN_SUSPICION_MS);
  });

  it("always keeps suspicion < critical < timeout for finite budgets", () => {
    for (let timeoutSec = 60; timeoutSec <= 43_200; timeoutSec += 137) {
      const { suspicionThresholdMs, criticalThresholdMs } = resolveRunOutputSilenceThresholds(timeoutSec);
      const timeoutMs = timeoutSec * 1000;
      expect(suspicionThresholdMs).toBeGreaterThan(0);
      expect(criticalThresholdMs).toBeGreaterThan(suspicionThresholdMs);
      expect(criticalThresholdMs).toBeLessThan(timeoutMs);
      expect(suspicionThresholdMs).toBeLessThan(timeoutMs);
    }
  });
});

describe("agentConfiguredTimeoutSec", () => {
  it("mirrors asNumber(config.timeoutSec, 0) semantics", () => {
    expect(agentConfiguredTimeoutSec({ timeoutSec: 3600 })).toBe(3600);
    expect(agentConfiguredTimeoutSec({ timeoutSec: 0.5 })).toBe(0.5);
    expect(agentConfiguredTimeoutSec({})).toBe(0);
    expect(agentConfiguredTimeoutSec({ timeoutSec: "3600" })).toBe(0);
    expect(agentConfiguredTimeoutSec(null)).toBe(0);
    expect(agentConfiguredTimeoutSec(undefined)).toBe(0);
  });
});
