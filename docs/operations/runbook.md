# Operations Runbook

## Transfer Orchestrator

### Overview

The Transfer Orchestrator manages the lifecycle of transfer executions between agents. A transfer follows a strict state machine: `pending` → `running` → `completed` or `failed`.

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/transfers` | Create a new transfer execution |
| GET | `/api/transfers` | List all transfers (optional `?customerId=` filter) |
| GET | `/api/transfers/:transferId` | Get a single transfer execution |
| POST | `/api/transfers/:transferId/start` | Start a pending transfer |
| POST | `/api/transfers/:transferId/complete` | Complete a running transfer |
| POST | `/api/transfers/:transferId/fail` | Fail a running transfer (body: `{ "error": "..." }`) |

### State Machine

```
pending ──► running ──► completed
                 │
                 └──► failed
```

- `pending`: awaiting start signal
- `running`: transfer in progress
- `completed`: transfer finished successfully
- `failed`: transfer encountered an error

### Company Boundary Enforcement

The companyBoundary middleware validates that the requesting agent's `companyId` matches the transfer's `customerId`. Access is denied with `403` when the owning agent is outside the transfer's customer scope.

### Health

- Transfer execution state is stored in-memory (non-persistent). Restarting the server clears all active transfers.
- For persistence requirements, the store can be backed by a database adapter.

### Troubleshooting

- **Transfer stuck in `running`**: Check source and target agent connectivity. Use `POST /api/transfers/:id/fail` to force-fail.
- **403 on transfer access**: Verify agent's `companyId` matches the transfer's `customerId`.
- **400 on state transition**: Ensure the current status allows the target (e.g., cannot complete a `pending` transfer directly).
