import { detectFileType } from './file-type.js';

describe('detectFileType', () => {
  it.each([
    ['JPEG', [0xff, 0xd8, 0xff, 0xe0], 'image/jpeg'],
    ['PNG', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'image/png'],
    ['PDF', [...Buffer.from('%PDF-1.7')], 'application/pdf'],
  ])('detects %s from its magic bytes', (_name, bytes, expected) => {
    expect(detectFileType(Buffer.from(bytes))).toBe(expected);
  });

  it.each([
    ['empty', []],
    ['text', [...Buffer.from('hello world')]],
    ['truncated PNG header', [0x89, 0x50, 0x4e]],
    ['GIF', [...Buffer.from('GIF89a')]],
  ])('returns null for %s', (_name, bytes) => {
    expect(detectFileType(Buffer.from(bytes))).toBeNull();
  });
});
