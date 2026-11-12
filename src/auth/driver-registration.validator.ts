import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ApiValidationException, type FieldError } from '../common/errors/api-validation.exception.js';
import { toFieldErrors } from '../common/validation/to-field-errors.js';
import {
  checkUpload,
  IMAGE_TYPES,
  type UploadRule,
  type ValidatedFile,
} from '../storage/upload-validation.js';
import { DriverRegistrationFieldsDto } from './dto/registration.dto.js';

export type DriverFileField = 'licenceImage' | 'insuranceDocument' | 'photo';

export type DriverUploads = Partial<Record<DriverFileField, Express.Multer.File[]>>;

export interface ValidDriverRegistration {
  fields: DriverRegistrationFieldsDto;
  files: Record<DriverFileField, ValidatedFile>;
}

const FILE_RULES: Record<DriverFileField, UploadRule> = {
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
    types: IMAGE_TYPES,
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
  for (const [field, rule] of Object.entries(FILE_RULES) as [DriverFileField, UploadRule][]) {
    const result = checkUpload(uploads?.[field]?.[0], rule);
    if (result.ok) files[field] = result.file;
    else details.push({ field, message: result.message });
  }

  if (details.length > 0) {
    throw new ApiValidationException(details, 'Driver registration failed validation');
  }
  return { fields, files };
}
