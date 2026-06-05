import type { BridgeTransferStatus, RouteEvaluationStrategy, RouteProbeOutcome } from "../constants.js";

export interface BridgeTransfer {
  id: string;
  companyId: string;
  sourceAgentId: string;
  destinationAgentId: string;
  payloadType: string;
  payload: Record<string, unknown>;
  status: BridgeTransferStatus;
  routeStrategy: RouteEvaluationStrategy | null;
  probeRunId: string | null;
  probeAttemptedAt: Date | null;
  probeResult: RouteProbeResult | null;
  evaluatedAt: Date | null;
  fallbackReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RouteProbePayload {
  type: "route_probe";
  transferId: string;
  sourceAgentId: string;
  destinationAgentId: string;
  destinationAdapterType: string;
  probeHint: string | null;
}

export interface RouteProbeResult {
  outcome: RouteProbeOutcome;
  latencyMs: number | null;
  endpoint: string | null;
  error: string | null;
  reportedAt: string;
}

export interface RouteEvaluationInput {
  companyId: string;
  sourceAgentId: string;
  destinationAgentId: string;
  payloadType: string;
  payload: Record<string, unknown>;
}

export interface RouteEvaluationResult {
  transferId: string;
  strategy: RouteEvaluationStrategy;
  directAvailable: boolean;
  probeResult: RouteProbeResult | null;
  evaluatedAt: string;
}
