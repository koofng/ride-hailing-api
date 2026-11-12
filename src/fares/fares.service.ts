import { Injectable } from '@nestjs/common';
import { FIXED_FARE, isWithinServiceArea, type Point } from './pricing.js';

/** Spec: `FareQuote` */
export interface FareQuoteResponse {
  fare: { amount: number; currency: string };
  withinServiceArea: boolean;
}

/**
 * The fare is defined only on the server. Booking a trip uses this same
 * quote, so the price shown before booking is always the price charged.
 */
@Injectable()
export class FaresService {
  quote(origin: Point, destination: Point): FareQuoteResponse {
    return {
      fare: { amount: FIXED_FARE.amount, currency: FIXED_FARE.currency },
      withinServiceArea: isWithinServiceArea(origin) && isWithinServiceArea(destination),
    };
  }
}
