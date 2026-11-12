export type AllowedMimeType = 'image/jpeg' | 'image/png' | 'application/pdf';

const SIGNATURES: { type: AllowedMimeType; bytes: number[] }[] = [
  { type: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { type: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { type: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46, 0x2d] }, // %PDF-
];

/**
 * Detects the file type from its first bytes. The client-supplied
 * Content-Type is not trusted, since anyone can send any value.
 */
export function detectFileType(buffer: Buffer): AllowedMimeType | null {
  for (const { type, bytes } of SIGNATURES) {
    if (buffer.length >= bytes.length && bytes.every((b, i) => buffer[i] === b)) {
      return type;
    }
  }
  return null;
}
