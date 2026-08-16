import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ContextFileAuthorizationRegistry } from '../authorization';

describe('ContextFileAuthorizationRegistry', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'chaptale-context-auth-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('authorize 后 isAuthorized 为 true；未授权为 false', async () => {
    const filePath = path.join(tempDir, 'a.txt');
    await writeFile(filePath, 'x');
    const registry = new ContextFileAuthorizationRegistry();

    await expect(registry.isAuthorized(filePath)).resolves.toBe(false);
    await registry.authorize(filePath);
    await expect(registry.isAuthorized(filePath)).resolves.toBe(true);
  });

  it('不存在的路径不入池且永远未授权', async () => {
    const registry = new ContextFileAuthorizationRegistry();
    const missing = path.join(tempDir, 'missing.txt');

    await registry.authorize(missing);
    await expect(registry.isAuthorized(missing)).resolves.toBe(false);
  });

  it('以 realpath 为键：符号链接指向已授权文件视为已授权，指向未授权文件视为未授权', async () => {
    const realPath = path.join(tempDir, 'real.txt');
    const otherPath = path.join(tempDir, 'other.txt');
    const linkPath = path.join(tempDir, 'link.txt');
    await writeFile(realPath, 'x');
    await writeFile(otherPath, 'x');
    await symlink(realPath, linkPath);
    const registry = new ContextFileAuthorizationRegistry();

    await registry.authorize(realPath);
    await expect(registry.isAuthorized(linkPath)).resolves.toBe(true);
    await expect(registry.isAuthorized(otherPath)).resolves.toBe(false);
  });

  it('clear 清空全部授权', async () => {
    const filePath = path.join(tempDir, 'a.txt');
    await writeFile(filePath, 'x');
    const registry = new ContextFileAuthorizationRegistry();

    await registry.authorize(filePath);
    registry.clear();
    await expect(registry.isAuthorized(filePath)).resolves.toBe(false);
  });
});
