# Architecture Decision Records (ADRs)

This directory contains Architecture Decision Records for the WebRTC MediaSoup Live Proctoring System.

## What is an ADR?

An Architecture Decision Record (ADR) is a document that captures an important architectural decision made along with its context and consequences.

## ADR Index

| ADR | Title | Status | Date |
|-----|-------|--------|------|
| [ADR-001](./001-monorepo-structure.md) | Monorepo Structure with pnpm Workspaces | Accepted | 2025-12-15 |
| [ADR-002](./002-sfu-architecture.md) | SFU Architecture with mediasoup | Accepted | 2025-12-15 |
| [ADR-003](./003-signaling-protocol.md) | WebSocket Signaling Protocol Design | Accepted | 2025-12-16 |
| [ADR-004](./004-state-management.md) | Frontend State Management with Zustand | Accepted | 2025-12-17 |
| [ADR-005](./005-validation-with-zod.md) | Runtime Validation with Zod | Accepted | 2025-12-17 |
| [ADR-006](./006-nestjs-websocket.md) | NestJS WebSocket Gateway | Accepted | 2025-12-18 |
| [ADR-007](./007-reconnection-strategy.md) | WebRTC Reconnection Strategy | Accepted | 2025-12-20 |

## ADR Template

When creating a new ADR, use the following template:

```markdown
# ADR-XXX: Title

## Status
[Proposed | Accepted | Deprecated | Superseded]

## Date
YYYY-MM-DD

## Context
What is the issue that we're seeing that is motivating this decision or change?

## Decision
What is the change that we're proposing and/or doing?

## Consequences
What becomes easier or more difficult to do because of this change?

### Positive
- Benefit 1
- Benefit 2

### Negative
- Drawback 1
- Drawback 2

### Risks
- Risk 1
- Risk 2

## Alternatives Considered
What other options were considered? Why weren't they chosen?
```

## References

- [Michael Nygard's ADR Blog Post](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions)
- [ADR Tools](https://github.com/npryce/adr-tools)
