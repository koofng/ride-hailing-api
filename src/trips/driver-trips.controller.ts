import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/jwt-auth.guard.js';
import type { AuthUser } from '../auth/token.service.js';
import { ResponseMessage } from '../common/decorators/response-message.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { Role } from '../users/role.enum.js';
import { DriverTripsService } from './driver-trips.service.js';
import { NearbyQuery } from './dto/nearby.query.js';
import type { TripRequestResponse } from './trip-request-view.js';
import type { TripResponse } from './trip-view.js';

/**
 * Driver-only trip actions. Registered before TripsController so that
 * /trips/requests is not taken for /trips/:tripId.
 */
@Controller('trips')
@Roles(Role.DRIVER)
export class DriverTripsController {
  constructor(private readonly driverTrips: DriverTripsService) {}

  /** operationId: listTripRequests */
  @Get('requests')
  @ResponseMessage('Trip requests retrieved successfully')
  listTripRequests(
    @CurrentUser() caller: AuthUser,
    @Query() position: NearbyQuery,
  ): Promise<TripRequestResponse[]> {
    return this.driverTrips.listRequests(caller, position);
  }

  /** operationId: acceptTrip */
  @Post(':tripId/accept')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Trip accepted successfully')
  acceptTrip(@CurrentUser() caller: AuthUser, @Param('tripId') tripId: string): Promise<TripResponse> {
    return this.driverTrips.accept(caller, tripId);
  }

  /** operationId: declineTrip */
  @Post(':tripId/decline')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Trip request declined')
  declineTrip(@CurrentUser() caller: AuthUser, @Param('tripId') tripId: string): Promise<void> {
    return this.driverTrips.decline(caller, tripId);
  }
}
