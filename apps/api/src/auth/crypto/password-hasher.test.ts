import { describe, expect, it } from 'vitest';

import { PasswordHasher } from './password-hasher.js';

describe('PasswordHasher', () => {
  const passwordHasher = new PasswordHasher();

  it('verifies the correct password', async () => {
    const passwordHash = await passwordHasher.hash('correct horse battery staple');

    await expect(passwordHasher.verify('correct horse battery staple', passwordHash)).resolves.toBe(
      true,
    );
  });

  it('rejects an incorrect password', async () => {
    const passwordHash = await passwordHasher.hash('correct horse battery staple');

    await expect(passwordHasher.verify('incorrect password', passwordHash)).resolves.toBe(false);
  });

  it('uses an independent random salt for every password hash', async () => {
    const firstHash = await passwordHasher.hash('same password');
    const secondHash = await passwordHasher.hash('same password');

    expect(firstHash).not.toBe(secondHash);
    expect(firstHash).toMatch(/^scrypt\$v1\$/u);
    expect(secondHash).toMatch(/^scrypt\$v1\$/u);
  });

  it.each([
    '',
    'scrypt',
    'scrypt$v2$c2FsdA$ZGlnZXN0',
    'scrypt$v1$invalid!$ZGlnZXN0',
    'scrypt$v1$c2FsdA$invalid!',
    'scrypt$v1$c2FsdA',
    'pbkdf2$v1$c2FsdA$ZGlnZXN0',
  ])('safely rejects a malformed serialized hash: %j', async (serializedHash) => {
    await expect(passwordHasher.verify('password', serializedHash)).resolves.toBe(false);
  });
});
