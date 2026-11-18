import { describe, expect, it } from 'vitest';

import { parseToolDetail } from '../tool-detail';
import type { ToolActivity } from '../transcript';

function activity(fields: Partial<ToolActivity> & Pick<ToolActivity, 'name'>): ToolActivity {
  return {
    kind: 'tool',
    id: 'call-1',
    key: '0:call-1',
    summary: fields.name,
    input: {},
    ...fields
  };
}

describe('parseToolDetail', () => {
  it('work_read 提取分区、资料属性、字数与纯文本正文，剥离 CreationResult 外壳', () => {
    const detail = parseToolDetail(
      activity({
        name: 'work_read',
        input: { workId: 'w-uuid', entryId: 'e-uuid' },
        result: {
          error: false,
          text: JSON.stringify({
            ok: true,
            value: {
              workId: 'w-uuid',
              entryId: 'e-uuid',
              section: 'resource',
              kind: 'document',
              title: '林黛玉',
              wordCount: 128,
              pending: true,
              content: '金陵十二钗正册之首。\n生得倾城倾国之貌。',
              attributes: { type: '人物', aliases: ['颦颦', '潇湘妃子'], tags: ['金陵十二钗'], cover: null }
            }
          })
        }
      })
    );

    expect(detail.meta).toEqual([
      '资料',
      '类型：人物',
      '别名：颦颦、潇湘妃子',
      '标签：金陵十二钗',
      '128 字',
      '待接受修改'
    ]);
    expect(detail.body).toBe('金陵十二钗正册之首。\n生得倾城倾国之貌。');
    expect(detail.rawOutput).toContain('\n  "ok": true');
  });

  it('work_grep 生成带行号、原文摘录与可打开文档目标的命中列表', () => {
    const detail = parseToolDetail(
      activity({
        name: 'work_grep',
        input: { workId: 'w1', pattern: '通灵宝玉' },
        result: {
          error: false,
          text: JSON.stringify({
            ok: true,
            value: [
              {
                workId: 'w1',
                entryId: 'c8',
                revisionId: 'r8',
                title: '第八回',
                line: 42,
                text: '莫失莫忘，仙寿恒昌。'
              }
            ]
          })
        }
      })
    );

    expect(detail.items).toEqual([
      {
        key: 'c8:42:0',
        target: { workId: 'w1', entryId: 'c8', title: '第八回' },
        meta: '第 42 行',
        snippet: '莫失莫忘，仙寿恒昌。'
      }
    ]);
  });

  it('work_edit 与嵌套 work_write 从参数和结果提取替换对照及可读正文', () => {
    const editDetail = parseToolDetail(
      activity({
        name: 'work_edit',
        input: {
          workId: 'w1',
          entryId: 'c1',
          expectedRevisionId: 'r1',
          oldText: '将军守城。',
          newText: '沈临冒雪守城。'
        },
        result: {
          error: false,
          text: JSON.stringify({
            ok: true,
            value: {
              kind: 'pending',
              entry: {
                workId: 'w1',
                entryId: 'c1',
                section: 'manuscript',
                kind: 'document',
                title: '序章',
                wordCount: 7
              }
            }
          })
        }
      })
    );
    expect(editDetail.meta).toEqual(['文稿', '待接受修改', '7 字']);
    expect(editDetail.edits).toEqual([{ oldText: '将军守城。', newText: '沈临冒雪守城。' }]);

    const nestedWrite = parseToolDetail(
      activity({
        name: 'work_write',
        nested: true,
        input: {
          workId: 'w1',
          section: 'resource',
          title: '沈霁',
          attributes: { type: '人物', aliases: ['沈三郎'] },
          content: '北境守将。'
        },
        result: { text: '', error: false }
      })
    );
    expect(nestedWrite.meta).toEqual(['资料', '类型：人物', '别名：沈三郎']);
    expect(nestedWrite.body).toBe('北境守将。');
  });

  it('事件与关系列表通过标题解析器把资源与章节 ID 映射为可读标题和双端链接', () => {
    const lookup = (id: string) =>
      ({
        r1: { workId: 'w1', entryId: 'r1', title: '贾母', kind: 'document' as const },
        r2: { workId: 'w1', entryId: 'r2', title: '林黛玉', kind: 'document' as const },
        c3: { workId: 'w1', entryId: 'c3', title: '第三回', kind: 'document' as const }
      })[id];

    const recordLs = parseToolDetail(
      activity({
        name: 'work_record_ls',
        input: { workId: 'w1' },
        result: {
          error: false,
          text: JSON.stringify({
            ok: true,
            value: [
              {
                recordId: 'rec-1',
                resourceIds: ['r2', 'r1'],
                text: '黛玉初进荣国府拜见外祖母',
                source: { kind: 'chapter', chapterId: 'c3', revisionId: 'rev-1' },
                placement: { kind: 'chapter', chapterId: 'c3' },
                storyTime: '冬月初二',
                pending: true
              }
            ]
          })
        }
      }),
      lookup
    );
    expect(recordLs.items).toEqual([
      {
        key: 'rec-1',
        label: '黛玉初进荣国府拜见外祖母',
        meta: '林黛玉、贾母 · 发生于《第三回》 · 冬月初二 · 待审'
      }
    ]);

    const relationLs = parseToolDetail(
      activity({
        name: 'work_relation_ls',
        input: { workId: 'w1' },
        result: {
          error: false,
          text: JSON.stringify({
            ok: true,
            value: {
              relations: [
                {
                  relationId: 'rel-1',
                  resourceIds: ['r1', 'r2'],
                  type: '祖孙',
                  directed: true,
                  titles: ['外祖母', '外孙女'],
                  state: 'active',
                  milestones: []
                }
              ],
              types: []
            }
          })
        }
      }),
      lookup
    );
    expect(relationLs.items).toEqual([
      {
        key: 'rel-1',
        target: { workId: 'w1', entryId: 'r1', title: '贾母' },
        connector: '→',
        secondaryTarget: { workId: 'w1', entryId: 'r2', title: '林黛玉' },
        meta: '祖孙（外祖母 / 外孙女） · 持续中'
      }
    ]);
  });

  it('work_search 把段落、事件和关系按命中顺序列出，标明行号、进度截断与不随进度的资料', () => {
    const lookup = (id: string) =>
      ({
        r1: { workId: 'w1', entryId: 'r1', title: '贾母', kind: 'document' as const },
        r2: { workId: 'w1', entryId: 'r2', title: '林黛玉', kind: 'document' as const },
        c3: { workId: 'w1', entryId: 'c3', title: '第三回', kind: 'document' as const }
      })[id];
    const entry = { workId: 'w1', kind: 'document', section: 'manuscript' };
    const detail = parseToolDetail(
      activity({
        name: 'work_search',
        input: { workId: 'w1', query: '黛玉', offset: 0, limit: 10, asOf: 'c3' },
        result: {
          error: false,
          text: JSON.stringify({
            ok: true,
            value: {
              hits: [
                {
                  kind: 'entry',
                  entry: { ...entry, entryId: 'c3', title: '第三回' },
                  pending: true,
                  ignoresAsOf: false,
                  passages: [
                    { startLine: 4, endLine: 6, text: '黛玉方进入房时。' },
                    { startLine: 12, endLine: 12, text: '黛玉一一拜见过。' }
                  ]
                },
                {
                  kind: 'record',
                  record: {
                    recordId: 'rec-1',
                    resourceIds: ['r2'],
                    text: '黛玉初进荣国府',
                    placement: { kind: 'chapter', chapterId: 'c3' },
                    storyTime: ''
                  }
                },
                {
                  kind: 'relation',
                  relation: {
                    relationId: 'rel-1',
                    resourceIds: ['r1', 'r2'],
                    type: '祖孙',
                    directed: true,
                    titles: ['外祖母', '外孙女'],
                    state: 'active',
                    milestones: []
                  }
                },
                {
                  kind: 'entry',
                  entry: { ...entry, entryId: 'r2', title: '林黛玉', section: 'resource' },
                  pending: false,
                  ignoresAsOf: true,
                  passages: []
                },
                {
                  kind: 'entry',
                  entry: { ...entry, entryId: 'f1', title: '黛玉立绘', section: 'resource', kind: 'file' },
                  pending: false,
                  ignoresAsOf: true,
                  passages: []
                }
              ],
              hasMore: true
            }
          })
        }
      }),
      lookup
    );

    expect(detail.meta).toEqual(['只到《第三回》', '还有更多结果']);
    const chapter = { workId: 'w1', entryId: 'c3', title: '第三回' };
    expect(detail.items).toEqual([
      { key: 'c3:4', target: chapter, meta: '第 4–6 行 · 待审', snippet: '黛玉方进入房时。' },
      { key: 'c3:12', target: chapter, meta: '第 12 行 · 待审', snippet: '黛玉一一拜见过。' },
      { key: 'rec-1', label: '黛玉初进荣国府', meta: '林黛玉 · 发生于《第三回》' },
      {
        key: 'rel-1',
        target: { workId: 'w1', entryId: 'r1', title: '贾母' },
        connector: '→',
        secondaryTarget: { workId: 'w1', entryId: 'r2', title: '林黛玉' },
        meta: '祖孙（外祖母 / 外孙女） · 持续中'
      },
      {
        key: 'r2',
        target: { workId: 'w1', entryId: 'r2', title: '林黛玉' },
        meta: '资料 · 名称命中 · 不随进度'
      },
      { key: 'f1', label: '黛玉立绘', meta: '文件 · 名称命中 · 不随进度' }
    ]);

    const empty = parseToolDetail(
      activity({
        name: 'work_search',
        input: { workId: 'w1', query: '宝钗', offset: 0, limit: 10 },
        result: { error: false, text: JSON.stringify({ ok: true, value: { hits: [], hasMore: false } }) }
      })
    );
    expect(empty).toMatchObject({ meta: [], items: [], emptyText: '无匹配内容' });
  });

  it('codemode 拆出执行耗时与标准输出，失败 CreationResult 提取可读错误消息', () => {
    const cm = parseToolDetail(
      activity({
        name: 'codemode',
        input: { code: 'return "ok";' },
        result: {
          error: false,
          text: 'Script completed in 38ms.\n\nOutput:\n\n已核对 3 份人物资料'
        }
      })
    );
    expect(cm.meta).toEqual(['耗时 38 ms']);
    expect(cm.body).toBe('已核对 3 份人物资料');

    const failed = parseToolDetail(
      activity({
        name: 'work_edit',
        input: { workId: 'w1', entryId: 'c1', oldText: '旧', newText: '新' },
        result: {
          error: true,
          text: JSON.stringify({ ok: false, error: { code: 'conflict', message: '文稿已被更新，请重新读取' } })
        }
      })
    );
    expect(failed.error).toBe('文稿已被更新，请重新读取');
  });
});
