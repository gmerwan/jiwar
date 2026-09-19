import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from "@nestjs/common";
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from "@nestjs/swagger";
import {
  CreateNoticeSchema,
  type CreateNotice,
  type Notice,
  type SearchNotices,
} from "@jiwar/contracts";
import { CurrentParticipant } from "../participants/current-participant.decorator.js";
import { NoticesService } from "./notices.service.js";
import type { SearchOutcome } from "./notices.repository.js";
import { SearchNoticesQuerySchema } from "./search-query.schema.js";

@ApiTags("notices")
@Controller("notices")
export class NoticesController {
  constructor(private readonly notices: NoticesService) {}

  /**
   * `SearchNoticesQuerySchema` rather than the bare contract schema: it is the
   * contract plus a blank-coordinate guard, because `z.coerce.number()` turns an
   * empty `?lat=` into `0` and would search from Null Island. See
   * `search-query.schema.ts`.
   */
  @Get()
  @ApiOkResponse({ description: "Published notices within the radius." })
  search(
    @Query({ schema: SearchNoticesQuerySchema }) query: SearchNotices,
  ): Promise<SearchOutcome> {
    return this.notices.search(query);
  }

  @Post()
  @ApiCreatedResponse({ description: "The notice is published immediately." })
  create(
    @Body({ schema: CreateNoticeSchema }) body: CreateNotice,
    @CurrentParticipant() participantId: string,
  ): Promise<{ publicId: string }> {
    return this.notices.create(body, participantId);
  }

  @Get(":publicId")
  @ApiOkResponse({ description: "A single notice, including cancelled ones." })
  findOne(@Param("publicId") publicId: string): Promise<Notice> {
    return this.notices.findOne(publicId);
  }

  /**
   * `@HttpCode(200)` is load-bearing: Nest defaults a POST handler to 201, and
   * this is not a creation. The brief's own test asserts `.expect(200)` on
   * cancel, so without it the route answers 201 and that case fails.
   */
  @Post(":publicId/cancel")
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ description: "Cancels a notice. Only its author may do this." })
  cancel(
    @Param("publicId") publicId: string,
    @CurrentParticipant() participantId: string,
  ): Promise<{ cancelled: true }> {
    return this.notices.cancel(publicId, participantId);
  }
}
