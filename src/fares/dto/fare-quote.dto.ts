import { CreateTripDto } from '../../trips/dto/create-trip.dto.js';

/**
 * Spec: `FareQuoteRequest`. The same pickup and destination as a booking,
 * with the same validation, so a quote can be booked as-is.
 */
export class FareQuoteDto extends CreateTripDto {}
