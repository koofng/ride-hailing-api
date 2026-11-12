import {
  Controller,
  ForbiddenException,
  Get,
  Param,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../common/decorators/public.decorator.js';
import { StorageService } from './storage.service.js';

/**
 * Serves profile photos through signed, expiring links handed out in
 * authenticated responses. No JWT is needed here: the signature is the
 * authorisation, so the app can load the image with a plain image request.
 */
@Controller('files')
export class FilesController {
  constructor(private readonly storage: StorageService) {}

  @Public()
  @Get('photos/:name')
  async getPhoto(
    @Param('name') name: string,
    @Query('expires') expires: unknown,
    @Query('sig') sig: unknown,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const file = await this.storage.openSignedPhoto(name, expires, sig);
    if (!file) {
      // Same answer for a bad signature, an expired link and a missing file,
      // so the endpoint does not reveal which photos exist.
      throw new ForbiddenException('This link is invalid or has expired');
    }
    res.set({
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline',
    });
    return new StreamableFile(file.stream, { type: file.contentType, length: file.size });
  }
}
