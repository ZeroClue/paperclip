import { badRequest, notFound } from "../errors.js";

export type TransferExecutionStatus = "pending" | "running" | "completed" | "failed";

export type TransferExecution = {
  id: string;
  customerId: string;
  sourceAgentId: string;
  targetAgentId: string;
  status: TransferExecutionStatus;
  createdAt: Date;
  updatedAt: Date;
  error?: string;
  metadata?: Record<string, unknown>;
};

export type CreateTransferInput = {
  customerId: string;
  sourceAgentId: string;
  targetAgentId: string;
  metadata?: Record<string, unknown>;
};

export type TransferExecutionUpdate = {
  status?: TransferExecutionStatus;
  error?: string;
  metadata?: Record<string, unknown>;
};

type TransferExecutionEvent =
  | { type: "created"; execution: TransferExecution }
  | { type: "started"; executionId: string }
  | { type: "completed"; executionId: string }
  | { type: "failed"; executionId: string; error: string };

export function createTransferExecutionService() {
  const store = new Map<string, TransferExecution>();
  const listeners = new Set<(event: TransferExecutionEvent) => void>();

  let nextId = 1;

  function generateId(): string {
    const id = `txn-${Date.now().toString(36)}-${(nextId++).toString(36)}`;
    return id;
  }

  function create(input: CreateTransferInput): TransferExecution {
    if (!input.customerId || !input.sourceAgentId || !input.targetAgentId) {
      throw badRequest("customerId, sourceAgentId, and targetAgentId are required");
    }
    const execution: TransferExecution = {
      id: generateId(),
      customerId: input.customerId,
      sourceAgentId: input.sourceAgentId,
      targetAgentId: input.targetAgentId,
      status: "pending",
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: input.metadata,
    };
    store.set(execution.id, execution);
    emit({ type: "created", execution });
    return execution;
  }

  function get(id: string): TransferExecution | undefined {
    return store.get(id);
  }

  function list(customerId?: string): TransferExecution[] {
    const all = Array.from(store.values());
    if (customerId) return all.filter((e) => e.customerId === customerId);
    return all;
  }

  function update(id: string, update: TransferExecutionUpdate): TransferExecution {
    const existing = store.get(id);
    if (!existing) {
      throw notFound(`TransferExecution ${id} not found`);
    }
    if (update.status) {
      const allowed = getAllowedTransitions(existing.status);
      if (!allowed.includes(update.status)) {
        throw badRequest(`Cannot transition from ${existing.status} to ${update.status}`);
      }
    }
    const updated: TransferExecution = {
      ...existing,
      ...update,
      updatedAt: new Date(),
    };
    store.set(id, updated);

    if (update.status === "running") emit({ type: "started", executionId: id });
    if (update.status === "completed") emit({ type: "completed", executionId: id });
    if (update.status === "failed" && update.error) {
      emit({ type: "failed", executionId: id, error: update.error });
    }
    return updated;
  }

  function getByCustomerId(customerId: string): TransferExecution[] {
    return Array.from(store.values()).filter((e) => e.customerId === customerId);
  }

  function onEvent(listener: (event: TransferExecutionEvent) => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function emit(event: TransferExecutionEvent): void {
    for (const listener of listeners) {
      try {
        listener(event);
      } catch {
        // swallow listener errors
      }
    }
  }

  return { create, get, list, update, getByCustomerId, onEvent };
}

function getAllowedTransitions(current: TransferExecutionStatus): TransferExecutionStatus[] {
  switch (current) {
    case "pending":
      return ["running"];
    case "running":
      return ["completed", "failed"];
    case "completed":
      return [];
    case "failed":
      return [];
  }
}

export type TransferExecutionService = ReturnType<typeof createTransferExecutionService>;
