import { Controller, Get, Query } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { LatitudeSchema, LongitudeSchema, type GeocodeResult } from "@jiwar/contracts";
import { z } from "zod";
import { GeocodeService } from "./geocode.service.js";

const SearchQuerySchema = z.object({ q: z.string().max(200).default("") });
const ReverseQuerySchema = z.object({ lat: LatitudeSchema, lng: LongitudeSchema });

@ApiTags("geocode")
@Controller()
export class GeocodeController {
  constructor(private readonly geocode: GeocodeService) {}

  @Get("geocode")
  @ApiOkResponse({ description: "Address search results, proxied from Nominatim." })
  async search(
    @Query({ schema: SearchQuerySchema }) query: { q: string },
  ): Promise<{ results: GeocodeResult[] }> {
    return { results: await this.geocode.search(query.q) };
  }

  @Get("reverse-geocode")
  @ApiOkResponse({ description: "The nearest address label for a point." })
  async reverse(
    @Query({ schema: ReverseQuerySchema }) query: { lat: number; lng: number },
  ): Promise<{ result: GeocodeResult | null }> {
    return { result: await this.geocode.reverse(query.lat, query.lng) };
  }
}
