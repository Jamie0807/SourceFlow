import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(resolve(root, relativePath), 'utf8')) as T;
}

function readText(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), 'utf8');
}

function runCommitlint(message: string): boolean {
  try {
    execFileSync('corepack', ['pnpm', 'exec', 'commitlint'], {
      cwd: root,
      input: `${message}\n`,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return true;
  } catch {
    return false;
  }
}

function runCommitMsgHook(message: string): boolean {
  const tempDirectory = mkdtempSync(join(tmpdir(), 'sourceflow-t002-'));
  const messagePath = join(tempDirectory, 'commit-message.txt');
  writeFileSync(messagePath, `${message}\n`, 'utf8');

  try {
    execFileSync('sh', [resolve(root, '.husky/commit-msg'), messagePath], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return true;
  } catch {
    return false;
  } finally {
    rmSync(tempDirectory, { recursive: true, force: true });
  }
}

describe('T002 工程提交与质量 Hook', () => {
  it('通过 Commitizen 入口和允许的提交类型保持一致', () => {
    const packageJson = readJson<{
      scripts?: Record<string, string>;
      config?: { commitizen?: { path?: string } };
    }>('package.json');
    const commitlintConfig = readText('commitlint.config.cjs');
    const czConfig = require(resolve(root, 'cz.config.cjs')) as {
      types?: Array<{ value: string }>;
    };
    const commitlintRules = require(resolve(root, 'commitlint.config.cjs')) as {
      rules?: { 'type-enum'?: [number, string, string[]] };
    };
    const commitlintTypes = commitlintRules.rules?.['type-enum']?.[2] ?? [];

    expect(packageJson.scripts?.commit).toBe('cz');
    expect(packageJson.config?.commitizen?.path).toBe('cz-git');
    expect(czConfig.types?.map((type) => type.value)).toEqual(commitlintTypes);
    expect(commitlintTypes).toEqual([
      'feat',
      'fix',
      'docs',
      'refactor',
      'test',
      'chore',
      'build',
      'ci',
      'perf',
      'revert',
    ]);
    expect(commitlintConfig).toContain("'type-enum'");
    expect(commitlintConfig).toContain("'subject-case': [0]");
    expect(runCommitlint('style(tooling): 不允许的提交类型')).toBe(false);
    expect(runCommitlint('feat(auth): 支持中文提交说明')).toBe(true);
    expect(runCommitMsgHook('style(tooling): 不允许的提交类型')).toBe(false);
    expect(runCommitMsgHook('feat(auth): 支持中文提交说明')).toBe(true);
  });

  it('Hook 执行顺序满足 T002 且不触发自动提交或推送', () => {
    const preCommit = readText('.husky/pre-commit');
    const commitMsg = readText('.husky/commit-msg');
    const prePush = readText('.husky/pre-push');

    expect(preCommit).toContain('corepack pnpm exec lint-staged');
    expect(preCommit).toContain('corepack pnpm typecheck');
    expect(preCommit).toContain('corepack pnpm test:unit:quick -- --run');
    expect(preCommit.indexOf('lint-staged')).toBeLessThan(preCommit.indexOf('typecheck'));
    expect(preCommit.indexOf('typecheck')).toBeLessThan(preCommit.indexOf('test:unit:quick'));
    expect(commitMsg).toContain('corepack pnpm exec commitlint --edit "$1"');
    expect(prePush).toContain('corepack pnpm verify:push');
    expect(`${preCommit}\n${commitMsg}\n${prePush}`).not.toMatch(/git\s+(commit|push)/);
  });

  it('push 门禁和 staged 文件格式化配置存在', () => {
    const packageJson = readJson<{ scripts?: Record<string, string> }>('package.json');
    const lintStagedPath = ['.lint', 'staged', 'rc.json'].join('');
    const lintStaged = readJson<Record<string, string[]>>(lintStagedPath);
    const verifyPush = packageJson.scripts?.['verify:push'] ?? '';

    expect(verifyPush).toContain('pnpm lint');
    expect(verifyPush).toContain('pnpm format:check');
    expect(verifyPush).toContain('pnpm spellcheck');
    expect(verifyPush).toContain('pnpm typecheck');
    expect(verifyPush).toContain('pnpm test:unit');
    expect(verifyPush).toContain('pnpm test:component');
    expect(verifyPush).toContain('pnpm test:integration -- --grep @smoke');
    expect(verifyPush).toContain('pnpm build:web');
    expect(verifyPush).toContain('pnpm build:api');
    expect(verifyPush).toContain('pnpm build:worker');
    expect(verifyPush).toContain('docker compose');
    expect(packageJson.scripts?.['test:unit:quick']).toContain('--coverage=false');
    expect(packageJson.scripts?.['format:check']).toContain('scripts/**/*.{ts,tsx}');
    expect(packageJson.scripts?.['format:check']).toContain('*.{js,cjs,mjs,ts,json,yml,yaml,md}');
    expect(lintStaged['*.{js,ts,tsx}']).toContain('eslint --fix');
    expect(lintStaged['*.{js,ts,tsx,cjs,mjs,cts,mts,json,yml,yaml,md,css}']).toContain(
      'prettier --write',
    );
  });
});
