import { detectFileType, type AllowedMimeType } from './file-type.js';

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export const IMAGE_TYPES: AllowedMimeType[] = ['image/jpeg', 'image/png'];

export interface UploadRule {
  required: string;
  types: AllowedMimeType[];
  wrongType: string;
}

export interface ValidatedFile {
  buffer: Buffer;
  type: AllowedMimeType;
}

export type UploadCheck = { ok: true; file: ValidatedFile } | { ok: false; message: string };

/** Checks one uploaded file for presence, size and real (byte-sniffed) type. */
export function checkUpload(file: Express.Multer.File | undefined, rule: UploadRule): UploadCheck {
  if (!file || file.size === 0) {
    return { ok: false, message: rule.required };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, message: 'File must be 5 MB or smaller' };
  }
  const type = detectFileType(file.buffer);
  if (!type || !rule.types.includes(type)) {
    return { ok: false, message: rule.wrongType };
  }
  return { ok: true, file: { buffer: file.buffer, type } };
}
