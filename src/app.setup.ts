import type { NestExpressApplication } from '@nestjs/platform-express';
import { StorageService } from './storage/storage.service.js';

/**
 * App-level settings shared by `main.ts` and the e2e tests, so tests run
 * against the same configuration as the real server.
 */
export function configureApp(app: NestExpressApplication): void {
  // Matches the spec's server URLs: http://localhost:3000/api
  app.setGlobalPrefix('api');

  // Public uploads (profile photos). Driver documents are stored outside
  // this directory and are never served.
  app.useStaticAssets(app.get(StorageService).publicDir, {
    prefix: '/uploads/',
    index: false,
    dotfiles: 'deny',
    fallthrough: true,
  });

  app.disable('x-powered-by');
  app.enableShutdownHooks();
}
