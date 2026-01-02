# ADR-005: Runtime Validation with Zod

## Status
Accepted

## Date
2025-12-17

## Context

WebRTC applications exchange many messages over WebSocket and handle various data structures:
- Signaling messages (SDP, ICE candidates)
- Room state updates
- User information
- Configuration payloads

TypeScript provides compile-time type safety, but runtime data from network sources is untyped. We need:

1. **Runtime validation**: Ensure incoming data matches expected shapes
2. **Type inference**: Generate TypeScript types from schemas
3. **Error messages**: Clear, actionable validation errors
4. **Environment validation**: Validate configuration at startup

### Problem

```typescript
// TypeScript won't catch this at runtime
interface User {
  id: string;
  role: 'candidate' | 'proctor';
}

// What if WebSocket sends { id: 123, role: 'hacker' }?
// TypeScript can't help us here
```

## Decision

We will use **Zod** for runtime validation across the entire stack.

### Schema Definition

```typescript
import { z } from 'zod';

export const UserSchema = z.object({
  id: z.string().uuid(),
  role: z.enum(['candidate', 'proctor', 'admin']),
  displayName: z.string().min(1).max(100),
});

// Type is automatically inferred
export type User = z.infer<typeof UserSchema>;
```

### Why Zod?

1. **TypeScript-first**: Types inferred from schemas, single source of truth
2. **Expressive API**: Composable, chainable schema definitions
3. **Excellent errors**: Detailed, structured error messages
4. **Tree-shakeable**: Import only what you need
5. **Zero dependencies**: No external runtime dependencies
6. **Transform support**: Parse and transform in one step

## Consequences

### Positive

1. **Single source of truth**: Schema defines both runtime validation and TypeScript type
2. **Fail fast**: Invalid data caught at system boundaries
3. **Self-documenting**: Schemas describe expected data shapes
4. **Error details**: Clear messages for debugging
5. **Compose schemas**: Extend, merge, pick, omit schemas
6. **Environment validation**: Catch missing/invalid config at startup

### Negative

1. **Runtime cost**: Validation takes CPU cycles
2. **Bundle size**: Adds ~10KB to frontend bundle
3. **Learning curve**: Team needs to learn Zod API
4. **Duplication potential**: Risk of schemas diverging from actual types

### Risks

1. **Performance**: Validation overhead on hot paths
   - *Mitigation*: Validate at boundaries, not on every access
2. **Schema drift**: Schemas not updated when types change
   - *Mitigation*: Types inferred from schemas, not vice versa

## Usage Patterns

### WebSocket Message Validation

```typescript
// schemas.ts
export const SdpOfferSchema = BaseMessageSchema.extend({
  type: z.literal(SignalMessageType.SDP_OFFER),
  payload: z.object({
    sdp: z.string(),
    targetPeerId: z.string().uuid().optional(),
  }),
});

// signaling.gateway.ts
@SubscribeMessage(SignalMessageType.SDP_OFFER)
handleSdpOffer(client: Socket, data: unknown) {
  const result = SdpOfferSchema.safeParse(data);
  
  if (!result.success) {
    this.sendError(client, {
      code: 'INVALID_MESSAGE',
      message: 'Invalid SDP offer format',
      details: result.error.flatten(),
    });
    return;
  }
  
  // result.data is typed as SdpOffer
  this.signalingService.handleOffer(client, result.data);
}
```

### Environment Configuration

```typescript
// env.config.ts
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']),
  PORT: z.string().transform(Number).pipe(z.number().positive()),
  MEDIASOUP_LISTEN_IP: z.string().ip(),
  MEDIASOUP_ANNOUNCED_IP: z.string().ip().optional(),
});

// Validate on startup
export const env = envSchema.parse(process.env);
// If invalid, throws with clear error message
```

### API Response Validation

```typescript
// On frontend, validate server responses
const RoomStateResponseSchema = z.object({
  roomId: z.string().uuid(),
  participants: z.array(ParticipantSchema),
  config: RoomConfigSchema,
});

async function fetchRoomState(roomId: string) {
  const response = await fetch(`/api/rooms/${roomId}`);
  const data = await response.json();
  
  // Throws if server sends unexpected shape
  return RoomStateResponseSchema.parse(data);
}
```

### Form Validation

```typescript
// Integrates with react-hook-form
import { zodResolver } from '@hookform/resolvers/zod';

const JoinRoomSchema = z.object({
  displayName: z.string().min(2, 'Name too short').max(50),
  roomCode: z.string().regex(/^[A-Z0-9]{6}$/, 'Invalid room code'),
});

function JoinRoomForm() {
  const { register, handleSubmit, formState: { errors } } = useForm({
    resolver: zodResolver(JoinRoomSchema),
  });
  // ...
}
```

## Schema Organization

```
packages/shared/src/
├── types/
│   ├── schemas.ts       # All Zod schemas
│   ├── enums.ts         # Enum definitions
│   └── index.ts         # Re-exports
```

## Validation Strategy

1. **Validate at boundaries**: Network input, environment, user input
2. **Trust internal data**: Don't re-validate on every function call
3. **Fail fast**: Throw on invalid data in critical paths
4. **Safe parse for optional**: Use `safeParse` when data may be invalid

## Alternatives Considered

### 1. io-ts
- **Pros**: Functional approach, codec system
- **Cons**: Steeper learning curve, fp-ts dependency
- **Rejected**: Zod's API is more approachable

### 2. Yup
- **Pros**: Mature, popular in React ecosystem
- **Cons**: TypeScript inference not as good, larger API surface
- **Rejected**: Zod has better TS integration

### 3. class-validator (NestJS default)
- **Pros**: Decorator-based, integrates with NestJS
- **Cons**: Class-based, reflection metadata, heavier
- **Rejected**: Zod works in both frontend and backend, more functional

### 4. ajv (JSON Schema)
- **Pros**: Standard JSON Schema, very fast
- **Cons**: Separate type definitions needed, less ergonomic
- **Rejected**: JSON Schema requires maintaining types separately

### 5. TypeScript-only (trust incoming data)
- **Pros**: No runtime overhead
- **Cons**: Security risk, runtime crashes on bad data
- **Rejected**: Unacceptable risk for networked application

## Implementation Notes

1. Define schemas in `@proctoring/shared` package
2. Infer types with `z.infer<typeof Schema>`
3. Use `safeParse` for expected-invalid scenarios
4. Use `parse` when invalid data is exceptional
5. Validate environment on server startup
6. Consider caching parsed schemas in hot paths

## References

- [Zod Documentation](https://zod.dev/)
- [Zod + React Hook Form](https://react-hook-form.com/get-started#SchemaValidation)
- [TypeScript Runtime Type Checking](https://2ality.com/2020/06/validating-data-typescript.html)
