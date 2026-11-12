import { Body, Controller, Get, Patch, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/jwt-auth.guard.js';
import type { AuthUser } from '../auth/token.service.js';
import { ResponseMessage } from '../common/decorators/response-message.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { Role } from '../users/role.enum.js';
import { ActiveDriversQuery } from './dto/active-drivers.query.js';
import { AvailabilityDto } from './dto/availability.dto.js';
import {
  DriversService,
  type ActiveDriverResponse,
  type AvailabilityResponse,
} from './drivers.service.js';

@Controller('drivers')
export class DriversController {
  constructor(private readonly drivers: DriversService) {}

  /** operationId: setMyAvailability */
  @Patch('me/availability')
  @Roles(Role.DRIVER)
  @ResponseMessage((data: AvailabilityResponse) => (data.available ? 'You are now online' : 'You are now offline'))
  setMyAvailability(
    @CurrentUser() caller: AuthUser,
    @Body() dto: AvailabilityDto,
  ): Promise<AvailabilityResponse> {
    return this.drivers.setAvailability(caller, dto);
  }

  /** operationId: listActiveDrivers */
  @Get('active')
  @Roles(Role.PASSENGER)
  @ResponseMessage('Active drivers retrieved successfully')
  listActiveDrivers(@Query() query: ActiveDriversQuery): Promise<ActiveDriverResponse[]> {
    return this.drivers.listActive({ lat: query.lat, lng: query.lng }, query.radiusKm);
  }
}
