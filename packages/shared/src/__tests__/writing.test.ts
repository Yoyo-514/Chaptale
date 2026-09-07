import { describe, expect, it } from 'vitest';

import { validateOutput } from '../task-output';
import { applyDocumentEdits, normalizeDocumentText, CandidateValidator } from '../writing';

describe('创作范围', () => {
  it('保留未触及的 BOM 与混合换行', () => {
    const raw = '\uFEFF甲\r\n乙\n丙\r丁';
    expect(applyDocumentEdits(raw, [{ from: 2, to: 3, insert: '新乙' }])).toBe('\uFEFF甲\r\n新乙\n丙\r丁');
    expect(normalizeDocumentText(raw)).toBe('甲\n乙\n丙\n丁');
    expect(applyDocumentEdits(raw, [])).toBe(raw);
  });
  it('多个范围按原坐标应用，插入采用主换行', () => {
    expect(
      applyDocumentEdits('甲\r\n乙\r\n丙\n', [
        { from: 0, to: 1, insert: '新\n甲' },
        { from: 4, to: 5, insert: '新丙' }
      ])
    ).toBe('新\r\n甲\r\n乙\r\n新丙\n');
  });
  it('拒绝倒序、越界、重叠与半个 surrogate', () => {
    for (const edits of [
      [{ from: 3, to: 1, insert: '' }],
      [{ from: 0, to: 9, insert: '' }],
      [
        { from: 0, to: 2, insert: '' },
        { from: 1, to: 3, insert: '' }
      ],
      [{ from: 1, to: 2, insert: '' }]
    ])
      expect(() => applyDocumentEdits('\uD83D\uDE00文', edits)).toThrow();
  });
  it('纯正文输出非空且有界，候选 id 不允许穿越', () => {
    expect(validateOutput('draft-markdown', '  ')).toMatchObject({ ok: false });
    expect(validateOutput('draft-markdown', '正文')).toMatchObject({ ok: true, value: '正文' });
    expect(validateOutput('draft-markdown', 'x'.repeat(1_000_001))).toMatchObject({ ok: false });
    expect(CandidateValidator.Check({ id: '../x' })).toBe(false);
  });
});
