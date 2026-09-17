import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { ParticipantsService } from "./participants.service.js";

export const PARTICIPANT_COOKIE = "jiwar_pid";
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

@Injectable()
export class ParticipantMiddleware implements NestMiddleware {
  constructor(private readonly participants: ParticipantsService) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    // signedCookies is populated by cookie-parser; a forged signature leaves it undefined.
    const existing = req.signedCookies?.[PARTICIPANT_COOKIE] as string | undefined;
    const participantId = await this.participants.ensure(existing);

    if (existing !== participantId) {
      res.cookie(PARTICIPANT_COOKIE, participantId, {
        httpOnly: true,
        signed: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: ONE_YEAR_MS,
        path: "/",
      });
    }

    (req as Request & { participantId?: string }).participantId = participantId;
    next();
  }
}
