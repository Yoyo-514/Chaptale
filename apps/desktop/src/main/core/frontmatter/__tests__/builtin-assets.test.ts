import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseFrontmatter } from '../parse';

const personasDir = path.join(__dirname, '../../../features/personas/builtin');

describe('自有解析器 vs 生产资产全量兼容', () => {
  it('全部内置 personas 解析成功且字段形状正确', () => {
    const files = readdirSync(personasDir).filter(name => name.endsWith('.md'));

    expect(files.length).toBeGreaterThan(3);

    for (const file of files) {
      const { frontmatter, body } = parseFrontmatter(readFileSync(path.join(personasDir, file), 'utf8'));

      expect(typeof frontmatter.id, file).toBe('string');
      expect(typeof frontmatter.name, file).toBe('string');
      expect(body.trim().length, file).toBeGreaterThan(0);

      if (frontmatter.memory) {
        const memory = frontmatter.memory as Record<string, unknown>;
        expect(Array.isArray(memory.read), file).toBe(true);
        expect(Array.isArray(memory.write), file).toBe(true);
        expect(Array.isArray(memory.propose), file).toBe(true);
      }

      if (frontmatter.skills !== undefined) {
        expect(Array.isArray(frontmatter.skills), file).toBe(true);
      }
    }
  });
});
