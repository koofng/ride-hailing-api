import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ResponseMessage } from '../common/decorators/response-message.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { Role } from '../users/role.enum.js';
import { FareQuoteDto } from './dto/fare-quote.dto.js';
import { FaresService, type FareQuoteResponse } from './fares.service.js';

@Controller('fares')
export class FaresController {
  constructor(private readonly fares: FaresService) {}

  /** operationId: quoteFare */
  @Post('quote')
  @Roles(Role.PASSENGER)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage((quote: FareQuoteResponse) =>
    quote.withinServiceArea
      ? 'Fare quote retrieved successfully'
      : 'Pickup or destination is outside the Antigonish service area',
  )
  quoteFare(@Body() dto: FareQuoteDto): FareQuoteResponse {
    return this.fares.quote(dto.origin, dto.destination);
  }
}
