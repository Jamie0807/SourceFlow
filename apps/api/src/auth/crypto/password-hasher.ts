import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';

const ALGORITHM = 'scrypt';
const FORMAT_VERSION = 'v1';
const SALT_LENGTH_BYTES = 16;
const DERIVED_KEY_LENGTH_BYTES = 64;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
const SCRYPT_OPTIONS = {
  N: 32_768,
  r: 8,
  p: 1,
  maxmem: 64 * 1024 * 1024,
} as const;

@Injectable()
export class PasswordHasher {
  async hash(password: string): Promise<string> {
    const salt = randomBytes(SALT_LENGTH_BYTES);
    const derivedKey = await deriveKey(password, salt);

    return [
      ALGORITHM,
      FORMAT_VERSION,
      salt.toString('base64url'),
      derivedKey.toString('base64url'),
    ].join('$');
  }

  async verify(password: string, serializedHash: string): Promise<boolean> {
    const parsedHash = parseSerializedHash(serializedHash);
    if (parsedHash === null) {
      return false;
    }

    try {
      const actualDerivedKey = await deriveKey(password, parsedHash.salt);
      return timingSafeEqual(actualDerivedKey, parsedHash.derivedKey);
    } catch {
      return false;
    }
  }
}

type ParsedHash = Readonly<{
  salt: Buffer;
  derivedKey: Buffer;
}>;

function parseSerializedHash(serializedHash: string): ParsedHash | null {
  const segments = serializedHash.split('$');
  if (segments.length !== 4) {
    return null;
  }

  const [algorithm, version, encodedSalt, encodedDerivedKey] = segments;
  if (
    algorithm !== ALGORITHM ||
    version !== FORMAT_VERSION ||
    encodedSalt === undefined ||
    encodedDerivedKey === undefined
  ) {
    return null;
  }

  const salt = decodeBase64Url(encodedSalt, SALT_LENGTH_BYTES);
  const derivedKey = decodeBase64Url(encodedDerivedKey, DERIVED_KEY_LENGTH_BYTES);
  if (salt === null || derivedKey === null) {
    return null;
  }

  return { salt, derivedKey };
}

function decodeBase64Url(value: string, expectedLength: number): Buffer | null {
  if (!BASE64URL_PATTERN.test(value)) {
    return null;
  }

  const decoded = Buffer.from(value, 'base64url');
  if (decoded.length !== expectedLength || decoded.toString('base64url') !== value) {
    return null;
  }

  return decoded;
}

function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, DERIVED_KEY_LENGTH_BYTES, SCRYPT_OPTIONS, (error, derivedKey) => {
      if (error !== null) {
        reject(error);
        return;
      }

      resolve(derivedKey);
    });
  });
}
