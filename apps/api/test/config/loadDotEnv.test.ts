import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadDotEnv } from '../../src/config/loadDotEnv';

describe('loadDotEnv', () => {
  let dir: string;
  let envPath: string;
  const KEY_ALREADY_SET = '__LOADDOTENV_TEST_ALREADY_SET__';
  const KEY_NEW = '__LOADDOTENV_TEST_NEW__';

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'loadDotEnv-'));
    envPath = path.join(dir, '.env');
    delete process.env[KEY_ALREADY_SET];
    delete process.env[KEY_NEW];
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    delete process.env[KEY_ALREADY_SET];
    delete process.env[KEY_NEW];
  });

  it('does not override a variable already set in process.env', () => {
    process.env[KEY_ALREADY_SET] = 'from-shell';
    writeFileSync(envPath, `${KEY_ALREADY_SET}=from-file\n`);
    loadDotEnv(envPath);
    expect(process.env[KEY_ALREADY_SET]).toBe('from-shell');
  });

  it('sets a variable that is not already present, trimming quotes', () => {
    writeFileSync(envPath, `${KEY_NEW}="quoted value"\n`);
    loadDotEnv(envPath);
    expect(process.env[KEY_NEW]).toBe('quoted value');
  });

  it('ignores comments, blank lines, and lines without =', () => {
    writeFileSync(envPath, `# comment\n\nNOT_A_VALID_LINE\n${KEY_NEW}=value\n`);
    loadDotEnv(envPath);
    expect(process.env[KEY_NEW]).toBe('value');
  });

  it('does nothing when the file does not exist', () => {
    expect(() => loadDotEnv(path.join(dir, 'missing.env'))).not.toThrow();
  });
});
