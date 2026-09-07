import { markdown } from '@codemirror/lang-markdown';
import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';

import { documentHeadings, documentHeadRange } from '../codemirror/markdown-navigation';

describe('Markdown 导航', () => {
  it('识别标题层级，忽略元数据与代码块中的伪标题', () => {
    const state = EditorState.create({
      doc: '---\ntitle: 文档\n---\n# 第一章\n\n```md\n# 代码\n```\n\n## 雪夜\n',
      extensions: [markdown()]
    });
    expect(documentHeadings(state).map(heading => [heading.title, heading.level])).toEqual([
      ['第一章', 1],
      ['雪夜', 2]
    ]);
    expect(documentHeadRange(state)).toEqual({ from: 3, to: 17 });
  });
  it('不折叠未闭合或越界的文件头', () => {
    expect(documentHeadRange(EditorState.create({ doc: '---\n未闭合' }))).toBeNull();
    expect(documentHeadRange(EditorState.create({ doc: `---\n${'x'.repeat(65536)}\n---` }))).toBeNull();
    expect(documentHeadings(EditorState.create({ doc: '', extensions: [markdown()] }))).toEqual([]);
  });
});
