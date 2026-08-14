import { describe, expect, it } from 'vitest';

import { parseFrontmatter } from '../parse';

const companionLike = `---
id: companion
name: 创作伙伴
type: chat
execution: chat
memory:
  read: [canon, notes, summaries]
  write: [notes]
  propose: []
enabled: true
---

你是创作伙伴正文。`;

describe('parseFrontmatter', () => {
  it('单行标量 + 布尔 + 两级嵌套（persona 形状）', () => {
    const { frontmatter, body } = parseFrontmatter(companionLike);

    expect(frontmatter).toEqual({
      id: 'companion',
      name: '创作伙伴',
      type: 'chat',
      execution: 'chat',
      memory: {
        read: ['canon', 'notes', 'summaries'],
        write: ['notes'],
        propose: []
      },
      enabled: true
    });
    expect(body).toBe('\n你是创作伙伴正文。');
  });

  it('proposal 形状：字符串、数字与字符串数组', () => {
    const { frontmatter } = parseFrontmatter(
      '---\nid: p-1\nproposalType: create\nrelatedTo: [character, setting]\npriority: 2\n---\n\n正文'
    );

    expect(frontmatter).toEqual({
      id: 'p-1',
      proposalType: 'create',
      relatedTo: ['character', 'setting'],
      priority: 2
    });
  });

  it('引号剥离与 CRLF 兼容', () => {
    const { frontmatter } = parseFrontmatter('---\r\nname: "带 引 号"\r\ntags: ["a", b]\r\n---\r\n');

    expect(frontmatter).toEqual({ name: '带 引 号', tags: ['a', 'b'] });
  });

  it('无 frontmatter → 空 map + 原文为 body', () => {
    expect(parseFrontmatter('只有正文')).toEqual({ frontmatter: {}, body: '只有正文' });
  });

  it('注释行跳过；块状父键后回到顶层键', () => {
    const { frontmatter } = parseFrontmatter(
      '---\n# 注释\nid: x\nmemory:\n  read: [a]\n  write: []\nenabled: true\n---\n'
    );

    expect(frontmatter).toEqual({
      id: 'x',
      memory: { read: ['a'], write: [] },
      enabled: true
    });
  });

  it('不支持的语法 → 抛错（调用方进 diagnostics，不静默丢字段）', () => {
    expect(() => parseFrontmatter('---\nkey: |\n  多行\n---\n')).toThrow(/frontmatter/);
    expect(() => parseFrontmatter('---\na: 1\n  b: 悬空缩进\n---\n')).toThrow();
  });
});
