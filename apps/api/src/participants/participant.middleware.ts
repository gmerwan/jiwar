import { Inject, Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { APP_CONFIG, type AppConfig } from "../config.js";
import { ParticipantsService } from "./participants.service.js";

export const PARTICIPANT_COOKIE = "jiwar_pid";
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * What the middleware attaches to a request: a memoised resolver that mints the
 * participant identity, and the id once it has been minted.
 *
 * The resolver is the whole point. Previously the middleware called
 * `ParticipantsService.ensure()` unconditionally on every request it matched,
 * which is `forRoutes("*")` — so any client that ignores `Set-Cookie` inserted
 * one `participants` row per request, without bound. Measured before this change:
 * 50 anonymous `GET /v1/notices` → +50 rows, 50 `GET /v1/categories` → +50, 20
 * detail 404s → +20, 20 requests that 400 → +20, and 10 requests to routes that
 * do not exist → +10. That table is the target of
 * `notices.author_participant_id`, so it can never be cheaply pruned.
 *
 * Deferring the insert to the point of use fixes it without narrowing
 * `forRoutes`, which matters because the set of routes needing an identity is a
 * property of the handlers (do they read `@CurrentParticipant()`?) rather than of
 * a path list that would have to be kept in sync by hand.
 */
export interface ParticipantRequestState {
  participantId?: string;
  resolveParticipant?: () => Promise<string>;
}

export type RequestWithParticipant = Request & ParticipantRequestState;

@Injectable()
export class ParticipantMiddleware implements NestMiddleware {
  constructor(
    private readonly participants: ParticipantsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    // signedCookies is populated by cookie-parser; a forged signature leaves the
    // value as `false` there (not undefined), which fails the UUID check inside
    // `ensure` and results in a fresh id just like a missing cookie would.
    const existing = req.signedCookies?.[PARTICIPANT_COOKIE] as string | undefined;
    const request = req as RequestWithParticipant;

    // No database work here, and no row written: a read-only request, a validation
    // failure and an unknown route all pass through having touched nothing.
    //
    // Memoised on first call so two `@CurrentParticipant()` parameters on one
    // handler (or a later guard and then a handler) share a single identity and a
    // single insert, rather than racing to create two rows.
    let pending: Promise<string> | undefined;
    request.resolveParticipant = () => {
      pending ??= this.mint(existing, res).then((participantId) => {
        request.participantId = participantId;
        return participantId;
      });
      return pending;
    };

    next();
  }

  /**
   * Resolves the identity and refreshes the cookie when it changed.
   *
   * `res.cookie()` is still safe at this point: the resolver is driven from a
   * parameter decorator, which Nest awaits during the pipes phase — before the
   * handler runs and long before any response body is written.
   */
  private async mint(existing: string | undefined, res: Response): Promise<string> {
    const participantId = await this.participants.ensure(existing);

    if (existing !== participantId) {
      res.cookie(PARTICIPANT_COOKIE, participantId, {
        httpOnly: true,
        signed: true,
        sameSite: "lax",
        secure: this.config.cookieSecure,
        maxAge: ONE_YEAR_MS,
        path: "/",
      });
    }

    return participantId;
  }
}
