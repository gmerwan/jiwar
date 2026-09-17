import { createParamDecorator, type ExecutionContext, InternalServerErrorException } from "@nestjs/common";
import type { Request } from "express";

export const CurrentParticipant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const req = ctx.switchToHttp().getRequest<Request & { participantId?: string }>();
    if (!req.participantId) {
      throw new InternalServerErrorException("Participant middleware did not run");
    }
    return req.participantId;
  },
);
