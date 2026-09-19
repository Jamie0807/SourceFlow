import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../../..');

const readJson = (relativePath: string) =>
  JSON.parse(readFileSync(join(repositoryRoot, relativePath), 'utf8')) as {
    scripts?: Record<string, string>;
    packageManager?: string;
  };

describe('SourceFlow workspace contract', () => {
  it('declares the expected pnpm workspace globs', () => {
    const workspace = readFileSync(join(repositoryRoot, 'pnpm-workspace.yaml'), 'utf8');

    expect(workspace).toContain('  - apps/*');
    expect(workspace).toContain('  - packages/*');
  });

  it('declares a pinned package manager and required quality scripts', () => {
    const packageJson = readJson('package.json');
    const scripts = packageJson.scripts ?? {};

    expect(packageJson.packageManager).toMatch(/^pnpm@\d+\.\d+\.\d+$/);
    expect(scripts).toMatchObject({
      lint: expect.any(String),
      'format:check': expect.any(String),
      spellcheck: expect.any(String),
      typecheck: expect.any(String),
      'test:unit': expect.any(String),
      'test:component': expect.any(String),
      'test:integration': expect.any(String),
    });
  });
});
