# ADR-001: Monorepo Structure with pnpm Workspaces

## Status
Accepted

## Date
2025-12-15

## Context

Building a real-time proctoring system requires multiple application components:
- A frontend web application for candidates and proctors
- A backend SFU (Selective Forwarding Unit) server
- Shared code (types, utilities, constants)

We need to decide how to organize the codebase structure and manage dependencies across these components.

### Key Requirements
1. Code sharing between frontend and backend (TypeScript types, validation schemas)
2. Independent deployment of each application
3. Unified development experience
4. Type safety across the entire stack
5. Efficient CI/CD pipelines

## Decision

We will use a **pnpm workspaces monorepo** structure with the following layout:

```
webrtc-mediasoup-live-proctoring/
├── apps/
│   ├── web/          # Next.js frontend
│   └── sfu/          # NestJS backend
├── packages/
│   ├── shared/       # Shared types, schemas, constants
│   └── webrtc-utils/ # WebRTC utilities
├── infra/            # Docker and deployment configs
├── pnpm-workspace.yaml
└── package.json
```

### Why pnpm?

1. **Efficient disk space**: pnpm uses a content-addressable store, saving significant disk space
2. **Strict dependency management**: Prevents phantom dependencies
3. **Fast installation**: Symlinks packages from global store
4. **Native workspace support**: First-class monorepo tooling
5. **npm-compatible**: Works with existing npm ecosystem

## Consequences

### Positive

1. **Single source of truth for types**: TypeScript interfaces defined once in `@proctoring/shared`
2. **Atomic commits**: Related changes across apps and packages in single commits
3. **Simplified dependency management**: Shared dependencies hoisted to root
4. **Consistent tooling**: ESLint, Prettier, TypeScript configs shared at root
5. **Efficient CI**: Only rebuild affected packages
6. **Developer experience**: One `pnpm install`, one `pnpm dev` to start everything

### Negative

1. **Build complexity**: Must build packages before apps that depend on them
2. **Learning curve**: Team needs to understand workspace protocols
3. **CI pipeline complexity**: Need to determine which packages changed
4. **Repository size**: Single large repository to clone

### Risks

1. **Build order dependencies**: Must ensure packages build before consuming apps
   - *Mitigation*: Use `pnpm -r run build` which respects topological order
2. **Version management**: Internal packages don't need version bumps
   - *Mitigation*: Use `workspace:*` protocol for internal dependencies

## Alternatives Considered

### 1. Polyrepo (Separate Repositories)
- **Pros**: Simple, independent deployments, clear ownership
- **Cons**: Code duplication, version sync issues, complex cross-repo changes
- **Rejected**: Too much friction for a small team, type sharing would be painful

### 2. Yarn Workspaces
- **Pros**: Mature, widely adopted
- **Cons**: Less efficient disk usage, hoisting can cause issues
- **Rejected**: pnpm's strict mode prevents common monorepo pitfalls

### 3. Nx Monorepo Tool
- **Pros**: Advanced caching, dependency graph visualization
- **Cons**: Steep learning curve, heavy tooling, overkill for project size
- **Rejected**: Adds complexity without proportional benefit at current scale

### 4. Turborepo
- **Pros**: Fast builds with caching, simple setup
- **Cons**: Less mature, limited features compared to Nx
- **Rejected**: May adopt in future if build times become an issue

## References

- [pnpm Workspaces Documentation](https://pnpm.io/workspaces)
- [TypeScript Project References](https://www.typescriptlang.org/docs/handbook/project-references.html)
