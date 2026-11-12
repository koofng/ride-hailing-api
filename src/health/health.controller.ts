import { Controller, Get, Logger, ServiceUnavailableException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Public } from '../common/decorators/public.decorator.js';
import { ResponseMessage } from '../common/decorators/response-message.decorator.js';
import { StorageService } from '../storage/storage.service.js';

/** A dependency that does not answer within this time counts as down. */
const CHECK_TIMEOUT_MS = 3000;

type Status = 'up' | 'down';

export interface HealthResponse {
  status: 'ok';
  database: Status;
  storage: Status;
}

/**
 * Liveness and readiness check for the hosting platform (Render's
 * healthCheckPath). Public, cheap, and 503 when a dependency is down so no
 * traffic is sent to a broken instance.
 */
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly storage: StorageService,
  ) {}

  @Public()
  @Get()
  @ResponseMessage('OK')
  async check(): Promise<HealthResponse> {
    const [database, storage] = await Promise.all([
      this.probe('database', () => this.db.query('SELECT 1')),
      this.probe('storage', () => this.storage.ping()),
    ]);
    if (database === 'down' || storage === 'down') {
      const down = [database === 'down' && 'database', storage === 'down' && 'file storage']
        .filter(Boolean)
        .join(' and ');
      throw new ServiceUnavailableException(`Service unavailable: ${down} not reachable`);
    }
    return { status: 'ok', database, storage };
  }

  private async probe(name: string, check: () => Promise<unknown>): Promise<Status> {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        check(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`timed out after ${CHECK_TIMEOUT_MS} ms`)), CHECK_TIMEOUT_MS);
        }),
      ]);
      return 'up';
    } catch (error) {
      this.logger.error(`Health check: ${name} is down: ${String(error)}`);
      return 'down';
    } finally {
      clearTimeout(timer);
    }
  }
}
