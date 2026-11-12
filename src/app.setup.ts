import type { NestExpressApplication } from '@nestjs/platform-express';

/**
 * App-level settings shared by `main.ts` and the e2e tests, so tests run
 * against the same configuration as the real server.
 */
export function configureApp(app: NestExpressApplication): void {
  // Matches the spec's server URLs: http://localhost:3000/api
  app.setGlobalPrefix('api');

  // Uploads are never served as static files. Profile photos are reached
  // only through signed links (see FilesController).

  app.disable('x-powered-by');
  app.enableShutdownHooks();
}
