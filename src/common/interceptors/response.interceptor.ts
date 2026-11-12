import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { map, type Observable } from 'rxjs';
import { RESPONSE_MESSAGE_KEY } from '../decorators/response-message.decorator.js';
import type { SuccessResponse } from '../response/api-response.js';

const DEFAULT_MESSAGE = 'Request successful';

/**
 * Wraps every handler's return value as `{ success: true, message, data }`.
 * The message comes from `@ResponseMessage()`; a handler that returns nothing
 * gets `data: null`. Files (StreamableFile) are sent as-is. Errors are
 * wrapped by `AllExceptionsFilter` instead.
 */
@Injectable()
export class ResponseInterceptor<T>
  implements NestInterceptor<T, SuccessResponse<T | null> | StreamableFile>
{
  constructor(private readonly reflector: Reflector) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<SuccessResponse<T | null> | StreamableFile> {
    const message =
      this.reflector.getAllAndOverride<string | undefined>(RESPONSE_MESSAGE_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? DEFAULT_MESSAGE;

    return next.handle().pipe(
      map((data) =>
        data instanceof StreamableFile
          ? data
          : { success: true as const, message, data: data ?? null },
      ),
    );
  }
}
