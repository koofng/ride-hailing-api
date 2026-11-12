import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import type { Socket } from 'socket.io';
import { STATUS_CODES } from 'node:http';
import type { FieldError } from '../errors/api-validation.exception.js';
import type { ErrorResponse } from '../response/api-response.js';

interface ErrorBody {
  statusCode: number;
  error: string;
  message: string;
  details?: FieldError[];
}

/**
 * Formats every error, HTTP or WebSocket, as the spec's `ErrorResponse` envelope:
 * `{ success: false, message, error: { statusCode, status, details? } }`.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const { statusCode, error, message, details } = this.toBody(exception);
    const body: ErrorResponse = {
      success: false,
      message,
      error: { statusCode, status: error, ...(details ? { details } : {}) },
    };
    if (host.getType() === 'ws') {
      // A failed WebSocket message: the same error body, sent to that socket.
      host.switchToWs().getClient<Socket>().emit('exception', body);
      return;
    }
    host.switchToHttp().getResponse<Response>().status(statusCode).json(body);
  }

  private toBody(exception: unknown): ErrorBody {
    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      const raw = exception.getResponse();
      let message: string = STATUS_CODES[statusCode] ?? 'Error';
      let details: FieldError[] | undefined;

      if (exception.cause instanceof SyntaxError) {
        // Malformed JSON body. Don't echo the parser's internal message.
        message = 'Request body is not valid JSON';
      } else if (typeof raw === 'string') {
        message = raw;
      } else if (raw && typeof raw === 'object') {
        const r = raw as { message?: unknown; details?: FieldError[] };
        if (typeof r.message === 'string') message = r.message;
        else if (Array.isArray(r.message)) message = r.message.join('; ');
        details = r.details;
      }

      return {
        statusCode,
        error: STATUS_CODES[statusCode] ?? 'Error',
        message,
        ...(details?.length ? { details } : {}),
      };
    }

    this.logger.error(exception);
    const statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    return {
      statusCode,
      error: STATUS_CODES[statusCode]!,
      message: 'Something went wrong. Please try again.',
    };
  }
}
