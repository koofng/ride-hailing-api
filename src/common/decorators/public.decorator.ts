import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Marks an endpoint as not requiring a JWT (`security: []` in the spec). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
