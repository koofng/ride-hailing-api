import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/jwt-auth.guard.js';
import type { AuthUser } from '../auth/token.service.js';
import { ResponseMessage } from '../common/decorators/response-message.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { Role } from '../users/role.enum.js';
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

  /** operationId: getTrip */
  @Get(':tripId')
  @ResponseMessage('Trip retrieved successfully')
  getTrip(@CurrentUser() caller: AuthUser, @Param('tripId') tripId: string): Promise<TripResponse> {
    return this.trips.findOne(caller, tripId);
  }
}
