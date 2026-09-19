import { createParamDecorator, type ExecutionContext, InternalServerErrorException } from "@nestjs/common";
import type { RequestWithParticipant } from "./participant.middleware.js";

/**
 * The participant id for this request, minting one on first use.
 *
 * Asynchronous on purpose. The middleware no longer inserts a `participants` row
 * on every request it matches — that made any cookie-ignoring client write one row
 * per request, unbounded — so the identity is created here, at the only place that
 * actually consumes it. A route without this decorator writes nothing.
 *
 * Nest 12 awaits a custom parameter decorator's factory: `createPipesFn` resolves
 * every parameter through `await`, and `isPipeable` returns true for a custom
 * decorator's string type. Verified directly against this version with a probe
 * controller returning an async factory's value — the handler received the
 * resolved string, not a pending Promise.
 */
export const CurrentParticipant = createParamDecorator(
  async (_data: unknown, ctx: ExecutionContext): Promise<string> => {
    const req = ctx.switchToHttp().getRequest<RequestWithParticipant>();
    if (!req.resolveParticipant) {
      throw new InternalServerErrorException("Participant middleware did not run");
    }
    return req.resolveParticipant();
  },
);
