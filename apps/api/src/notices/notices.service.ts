import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { CreateNotice, Notice, SearchNotices } from "@jiwar/contracts";
import { APP_CONFIG, type AppConfig } from "../config.js";
import { NoticesRepository, type SearchOutcome } from "./notices.repository.js";
import { isWellFormedPublicId } from "./search-query.schema.js";

@Injectable()
export class NoticesService {
  constructor(
    private readonly repository: NoticesRepository,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * The `maxRadiusKm` check lives here, not in the contract: the contract's
   * `MAX_RADIUS_KM_HARD_LIMIT` (500) is the absolute ceiling any deployment could
   * ever allow, while `config.maxRadiusKm` is *this* deployment's policy and is
   * env-tunable. A request between the two is well-formed but not permitted, so
   * it is rejected by the server rather than by the schema.
   */
  async search(params: SearchNotices): Promise<SearchOutcome> {
    if (params.radiusKm > this.config.maxRadiusKm) {
      throw new BadRequestException(`radiusKm must not exceed ${this.config.maxRadiusKm}`);
    }
    return this.repository.search(params, { pastGraceHours: this.config.pastGraceHours });
  }

  /**
   * `participantId` comes from the signed cookie via `@CurrentParticipant()` and
   * is never read from `input`, so a caller cannot publish under someone else's
   * identity by putting an id in the body — which would then let them cancel it.
   */
  async create(input: CreateNotice, participantId: string): Promise<{ publicId: string }> {
    try {
      const publicId = await this.repository.insert({
        categorySlug: input.categorySlug,
        title: input.title,
        description: input.description,
        venueName: input.venueName,
        address: input.address,
        lat: input.lat,
        lng: input.lng,
        startsAt: new Date(input.startsAt),
        attendance: input.attendance,
        organizerName: input.organizerName,
        organizerContact: input.organizerContact,
        authorParticipantId: participantId,
      });
      return { publicId };
    } catch (error) {
      // The repository signals an unknown or deactivated category slug with a
      // plain Error. That is a client mistake, not a server fault, so it is
      // remapped to a 400 — otherwise a typo'd slug surfaces as a 500.
      if (error instanceof Error && error.message.startsWith("Unknown category")) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  /**
   * A malformed id is answered as a plain 404 without touching the database.
   *
   * `publicId` is an unvalidated path parameter that is bound into SQL, and a NUL
   * byte inside it made postgres reject the whole statement at the protocol level
   * — a 500 from client-supplied garbage, plus the failing SQL and its bound
   * parameters in the server log. 404 is the honest answer regardless of the
   * driver: an id outside `nanoid`'s alphabet, or longer than the `varchar(16)`
   * column, cannot identify a row, so "not found" is what a query would have
   * concluded anyway. It also keeps the response indistinguishable from a
   * well-formed id that simply does not exist.
   */
  async findOne(publicId: string): Promise<Notice> {
    if (!isWellFormedPublicId(publicId)) throw new NotFoundException("Notice not found");
    const notice = await this.repository.findByPublicId(publicId, this.config.pastGraceHours);
    if (!notice) throw new NotFoundException("Notice not found");
    return notice;
  }

  /**
   * Author-only, enforced in SQL: `repository.cancel` matches on
   * `author_participant_id` as part of the UPDATE's WHERE, so a non-author's
   * request updates zero rows and returns false. Nothing here widens that — the
   * `participantId` argument is the cookie's, and there is no override path.
   *
   * 403 is returned for "not found" as well as "not yours", deliberately: a 404
   * here would confirm to a stranger which public ids exist and are cancellable.
   *
   * A malformed id gets that same 403, short-circuited before any SQL runs. The
   * guard is here for the NUL-byte 500 described on `PUBLIC_ID_PATTERN`, but the
   * code it returns is chosen to preserve this route's existing anti-enumeration
   * property: answering 404 for "unparseable" while every other unauthorised
   * request gets 403 would hand a prober a way to tell the two apart.
   */
  async cancel(publicId: string, participantId: string): Promise<{ cancelled: true }> {
    if (!isWellFormedPublicId(publicId)) {
      throw new ForbiddenException("Only the author can cancel this notice");
    }
    const cancelled = await this.repository.cancel(publicId, participantId);
    if (!cancelled) {
      throw new ForbiddenException("Only the author can cancel this notice");
    }
    return { cancelled: true };
  }
}
