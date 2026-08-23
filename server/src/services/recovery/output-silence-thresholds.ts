// Shared constants + pure threshold math for the active-run output-silence
// watchdog (recovery/service.ts). Kept dependency-free so the scaling policy
// can be unit-tested without a database.
//
// COO-777: historically suspicion/critical were fixed at 60min/240min. When an
// agent's adapter runs under a finite wall-clock timeout (adapterConfig
// timeoutSec, e.g. 3600), a fixed 60min suspicion window could never fire
// before the adapter timeout itself killed a fully silent run — silence was
// only noticed once the whole budget had burned. Thresholds are therefore
// scaled off the effective run timeout so genuinely silent runs surface while
// the run is still alive and recoverable.

export const ACTIVE_RUN_OUTPUT_SUSPICION_THRESHOLD_MS = 60 * 60 * 1000;
export const ACTIVE_RUN_OUTPUT_CRITICAL_THRESHOLD_MS = 4 * 60 * 60 * 1000;

// For runs with a finite adapter timeout: suspicion never waits longer than
// this cap (and never longer than 1/3 of the budget), so silent runs surface
// early instead of at the full legacy hour.
export const OUTPUT_SILENCE_TIMEOUT_SCALED_SUSPICION_CAP_MS = 10 * 60 * 1000;
// Floor keeps normal-budget watchdog windows from collapsing on every scan
// cycle; it yields to half the budget on very short timeouts so suspicion
// always fires inside the wall-clock budget.
export const OUTPUT_SILENCE_MIN_SUSPICION_MS = 5 * 60 * 1000;
// Scan prefilter window: the smallest suspicion threshold any run can have,
// so the candidate query never misses a run whose scaled suspicion is due.
export const OUTPUT_SILENCE_SCAN_CANDIDATE_WINDOW_MS = Math.min(
  ACTIVE_RUN_OUTPUT_SUSPICION_THRESHOLD_MS,
  OUTPUT_SILENCE_MIN_SUSPICION_MS,
);

export interface RunOutputSilenceThresholds {
  suspicionThresholdMs: number;
  criticalThresholdMs: number;
}

/**
 * Mirrors how adapters read `config.timeoutSec` (`asNumber(config.timeoutSec, 0)`):
 * only finite numbers count; anything else means "not configured".
 */
export function agentConfiguredTimeoutSec(
  adapterConfig: Record<string, unknown> | null | undefined,
): number {
  const raw = adapterConfig?.timeoutSec;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
}

/**
 * Resolves the output-silence watchdog thresholds for a run.
 *
 * - No finite configured timeout (unset/zero schema default, or explicit
 *   negative opt-out): keep the historical fixed windows — there is no
 *   wall-clock budget to surface ahead of. (Sandbox targets whose effective
 *   default timeout comes from the target rather than config also land here;
 *   the legacy 1h/4h windows already fire well inside that budget.)
 * - Finite timeout T: suspicion = max(min(floor(5min), T/2),
 *   min(cap(10min), T/3)) — the classic scaled window, floored at 5min for
 *   normal budgets but never pushed past half of a very short one. Critical
 *   keeps the historical 4x spacing when the budget allows and is always
 *   strictly inside T, so both levels still fire before the adapter
 *   wall-clock timeout kills the run.
 */
export function resolveRunOutputSilenceThresholds(
  effectiveTimeoutSec: number | null | undefined,
): RunOutputSilenceThresholds {
  const timeoutSec =
    typeof effectiveTimeoutSec === "number" && Number.isFinite(effectiveTimeoutSec)
      ? effectiveTimeoutSec
      : 0;
  if (timeoutSec <= 0) {
    return {
      suspicionThresholdMs: ACTIVE_RUN_OUTPUT_SUSPICION_THRESHOLD_MS,
      criticalThresholdMs: ACTIVE_RUN_OUTPUT_CRITICAL_THRESHOLD_MS,
    };
  }
  const timeoutMs = timeoutSec * 1000;
  const suspicionThresholdMs = Math.max(
    Math.min(OUTPUT_SILENCE_MIN_SUSPICION_MS, Math.floor(timeoutMs / 2)),
    Math.min(OUTPUT_SILENCE_TIMEOUT_SCALED_SUSPICION_CAP_MS, Math.floor(timeoutMs / 3)),
  );
  let criticalThresholdMs = Math.min(suspicionThresholdMs * 4, Math.floor((timeoutMs * 3) / 4));
  if (criticalThresholdMs <= suspicionThresholdMs || criticalThresholdMs >= timeoutMs) {
    // Degenerate ultra-short budgets: keep the ordering valid inside the budget.
    criticalThresholdMs = timeoutMs - 1;
  }
  return { suspicionThresholdMs, criticalThresholdMs };
}
