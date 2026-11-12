import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/jwt-auth.guard.js';
import type { AuthUser } from '../auth/token.service.js';
import { ResponseMessage } from '../common/decorators/response-message.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { Role } from '../users/role.enum.js';
import { CancelTripDto } from './dto/cancel-trip.dto.js';
import { CreateTripDto } from './dto/create-trip.dto.js';
import { ListTripsQuery } from './dto/list-trips.query.js';
import type { TripResponse } from './trip-view.js';
import { TripsService, type TripPage } from './trips.service.js';

@Controller('trips')
export class TripsController {
  constructor(private readonly trips: TripsService) {}

  /** operationId: createTrip */
  @Post()
  @Roles(Role.PASSENGER)
  @ResponseMessage('Trip requested successfully')
  createTrip(@CurrentUser() caller: AuthUser, @Body() dto: CreateTripDto): Promise<TripResponse> {
    return this.trips.create(caller, dto);
  }

  /** operationId: listTrips */
  @Get()
  @ResponseMessage('Trips retrieved successfully')
  listTrips(@CurrentUser() caller: AuthUser, @Query() query: ListTripsQuery): Promise<TripPage> {
    return this.trips.list(caller, query);
  }

  /** operationId: getActiveTrip. Declared before :tripId so "active" is not taken as an id. */
  @Get('active')
  @ResponseMessage((trip: TripResponse | null) =>
    trip ? 'Active trip retrieved successfully' : 'You have no active trip',
  )
  getActiveTrip(@CurrentUser() caller: AuthUser): Promise<TripResponse | null> {
    return this.trips.findActive(caller);
  }

  /** operationId: getTrip */
  @Get(':tripId')
  @ResponseMessage('Trip retrieved successfully')
  getTrip(@CurrentUser() caller: AuthUser, @Param('tripId') tripId: string): Promise<TripResponse> {
    return this.trips.findOne(caller, tripId);
  }

  /** operationId: cancelTrip */
  @Post(':tripId/cancel')
  @Roles(Role.PASSENGER)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Trip cancelled successfully')
  cancelTrip(
    @CurrentUser() caller: AuthUser,
    @Param('tripId') tripId: string,
    @Body() dto: CancelTripDto,
  ): Promise<TripResponse> {
    return this.trips.cancel(caller, tripId, dto);
  }
}
