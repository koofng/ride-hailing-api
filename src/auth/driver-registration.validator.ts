import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ApiValidationException, type FieldError } from '../common/errors/api-validation.exception.js';
import { toFieldErrors } from '../common/validation/to-field-errors.js';
import { detectFileType, type AllowedMimeType } from '../storage/file-type.js';
import { DriverRegistrationFieldsDto } from './dto/registration.dto.js';

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export type DriverFileField = 'licenceImage' | 'insuranceDocument' | 'photo';

export type DriverUploads = Partial<Record<DriverFileField, Express.Multer.File[]>>;

export interface ValidatedFile {
  buffer: Buffer;
  type: AllowedMimeType;
}

export interface ValidDriverRegistration {
  fields: DriverRegistrationFieldsDto;
  files: Record<DriverFileField, ValidatedFile>;
}

const FILE_RULES: Record<
  DriverFileField,
  { required: string; types: AllowedMimeType[]; wrongType: string }
> = {
  licenceImage: {
    required: 'Licence image is required',
    types: ['image/jpeg', 'image/png', 'application/pdf'],
    wrongType: 'Licence image must be a JPEG, PNG or PDF file',
  },
  insuranceDocument: {
    required: 'Proof of insurance is required',
    types: ['image/jpeg', 'image/png', 'application/pdf'],
    wrongType: 'Proof of insurance must be a JPEG, PNG or PDF file',
  },
  photo: {
    required: 'Profile photo is required',
    types: ['image/jpeg', 'image/png'],
    wrongType: 'Profile photo must be a JPEG or PNG image',
  },
};

/**
 * Validates the text fields and the three uploads together, so the Driver
 * gets every problem in one 400 response (spec example for `registerDriver`).
 */
export async function validateDriverRegistration(
  body: unknown,
  uploads: DriverUploads | undefined,
): Promise<ValidDriverRegistration> {
  const fields = plainToInstance(DriverRegistrationFieldsDto, body ?? {});
  const details: FieldError[] = toFieldErrors(await validate(fields, { whitelist: true }));

  const files = {} as Record<DriverFileField, ValidatedFile>;
  for (const [field, rule] of Object.entries(FILE_RULES) as [
    DriverFileField,
    (typeof FILE_RULES)[DriverFileField],
  ][]) {
    const file = uploads?.[field]?.[0];
    if (!file || file.size === 0) {
      details.push({ field, message: rule.required });
      continue;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      details.push({ field, message: 'File must be 5 MB or smaller' });
      continue;
    }
    const type = detectFileType(file.buffer);
    if (!type || !rule.types.includes(type)) {
      details.push({ field, message: rule.wrongType });
      continue;
    }
    files[field] = { buffer: file.buffer, type };
  }

  if (details.length > 0) {
    throw new ApiValidationException(details, 'Driver registration failed validation');
  }
  return { fields, files };
}
