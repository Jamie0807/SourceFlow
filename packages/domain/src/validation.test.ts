import { describe, expect, it } from 'vitest';

import {
  MAX_MEDIA_DURATION_SECONDS,
  MAX_SOURCE_SIZE_BYTES,
  assertValidSourceFile,
  validateSourceFile,
  validateBody,
  validateTags,
  validateText,
  validateTitle,
} from './index';

const validFile = {
  fileName: 'episode.mp4',
  mimeType: 'video/mp4',
  sizeBytes: 1024,
  durationSeconds: 60,
};

describe('source file validation', () => {
  it.each([
    ['episode.mp4', 'video/mp4'],
    ['episode.mp3', 'audio/mpeg'],
    ['episode.wav', 'audio/wav'],
    ['notes.txt', 'text/plain'],
  ])('accepts supported file %s', (fileName, mimeType) => {
    expect(validateSourceFile({ ...validFile, fileName, mimeType })).toEqual({ valid: true });
  });

  it('accepts exact size and duration boundaries', () => {
    expect(
      validateSourceFile({
        ...validFile,
        sizeBytes: MAX_SOURCE_SIZE_BYTES,
        durationSeconds: MAX_MEDIA_DURATION_SECONDS,
      }),
    ).toEqual({ valid: true });
  });

  it('rejects empty, oversized, overlong, and unsupported files', () => {
    expect(validateSourceFile({ ...validFile, sizeBytes: 0 }).valid).toBe(false);
    expect(
      validateSourceFile({ ...validFile, sizeBytes: MAX_SOURCE_SIZE_BYTES + 1 }),
    ).toMatchObject({ valid: false });
    expect(
      validateSourceFile({
        ...validFile,
        durationSeconds: MAX_MEDIA_DURATION_SECONDS + 1,
      }),
    ).toMatchObject({ valid: false });
    expect(
      validateSourceFile({
        ...validFile,
        fileName: 'episode.pdf',
        mimeType: 'application/pdf',
      }),
    ).toMatchObject({ valid: false });
  });

  it('rejects a mismatched extension and MIME type', () => {
    expect(validateSourceFile({ ...validFile, fileName: 'episode.mp3' })).toMatchObject({
      valid: false,
    });
    expect(() =>
      assertValidSourceFile({ ...validFile, sizeBytes: MAX_SOURCE_SIZE_BYTES + 1 }),
    ).toThrowError(/source file validation failed/i);
  });

  it('rejects a file without a recognizable extension', () => {
    expect(validateSourceFile({ ...validFile, fileName: 'episode' })).toMatchObject({
      valid: false,
    });
  });

  it('does not apply media duration limits to text files', () => {
    const textFile = {
      fileName: 'notes.txt',
      mimeType: 'text/plain',
      sizeBytes: validFile.sizeBytes,
    };

    expect(
      validateSourceFile({
        ...textFile,
      }),
    ).toEqual({ valid: true });
  });
});

describe('text field validation', () => {
  it('validates required text and tag limits', () => {
    expect(validateText('Title', 'title')).toEqual({ valid: true });
    expect(validateText('   ', 'title')).toMatchObject({ valid: false });
    expect(validateText('a'.repeat(121), 'title', 120)).toMatchObject({
      valid: false,
    });
    expect(validateTitle('A title')).toEqual({ valid: true });
    expect(validateBody('A body')).toEqual({ valid: true });
    expect(validateTags(['sourceflow', 'content'])).toEqual({ valid: true });
    expect(validateTags([])).toMatchObject({ valid: false });
    expect(validateTags(['a'.repeat(31)])).toMatchObject({ valid: false });
    expect(validateTags(Array.from({ length: 21 }, (_, index) => `tag-${index}`))).toMatchObject({
      valid: false,
    });
  });
});
