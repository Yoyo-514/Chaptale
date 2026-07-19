import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MemoryService } from '../service';

describe('MemoryService', () => {
  let rootDir: string;
  let cwd: string;
  let service: MemoryService;

  beforeEach(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chaptale-memory-root-'));
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'chaptale-memory-cwd-'));
    service = new MemoryService({ chaptaleRootDir: rootDir });
  });

  afterEach(async () => {
    await fs.rm(rootDir, { recursive: true, force: true });
    await fs.rm(cwd, { recursive: true, force: true });
  });

  it('returns empty sections when no memory has ever been created', async () => {
    await expect(service.readSections(cwd)).resolves.toEqual({});
  });

  it('collects author preferences from MEMORY.md and preferences directory', async () => {
    const memoryDir = path.join(rootDir, 'memory');
    await fs.mkdir(path.join(memoryDir, 'preferences'), { recursive: true });
    await fs.writeFile(path.join(memoryDir, 'MEMORY.md'), '- 喜欢短句', 'utf8');
    await fs.writeFile(path.join(memoryDir, 'preferences', 'style.md'), '- 避免网络流行语', 'utf8');

    const sections = await service.readSections(cwd);

    expect(sections.preferences).toContain('喜欢短句');
    expect(sections.preferences).toContain('避免网络流行语');
  });

  it('reads workspace style guide, recent summary and notes list', async () => {
    await fs.mkdir(path.join(cwd, '设定'), { recursive: true });
    await fs.writeFile(path.join(cwd, '设定', '创作守则.md'), '禁用词：xxx', 'utf8');
    const memoryDir = path.join(cwd, '.chaptale', 'memory');
    await fs.mkdir(path.join(memoryDir, 'summaries'), { recursive: true });
    await fs.mkdir(path.join(memoryDir, 'notes'), { recursive: true });
    await fs.writeFile(path.join(memoryDir, 'summaries', 'recent.md'), '第 3 章：决裂', 'utf8');
    await fs.writeFile(
      path.join(memoryDir, 'notes', 'fear-of-water.md'),
      '---\nkind: note\ntitle: 怕水\n---\n观察：林晚似乎怕水',
      'utf8'
    );

    const sections = await service.readSections(cwd);

    expect(sections.styleGuide).toBe('禁用词：xxx');
    expect(sections.recent).toBe('第 3 章：决裂');
    expect(sections.notes).toBe('fear-of-water.md: 观察：林晚似乎怕水');
  });

  it('truncates long files to head lines only', async () => {
    const memoryDir = path.join(rootDir, 'memory');
    await fs.mkdir(memoryDir, { recursive: true });
    const longContent = Array.from({ length: 60 }, (_, index) => `第 ${index + 1} 行`).join('\n');
    await fs.writeFile(path.join(memoryDir, 'MEMORY.md'), longContent, 'utf8');

    const sections = await service.readSections(cwd);

    expect(sections.preferences).toContain('第 20 行');
    expect(sections.preferences).not.toContain('第 21 行');
  });
});
