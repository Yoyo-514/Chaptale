import { describe, expect, it } from 'vitest';

import type { AssetRecord, ContentEntry } from '@chaptale/shared';

import { contentKindOptions, contentOptions } from '../options';

function entry(id: string, values: Partial<ContentEntry> = {}): ContentEntry {
  return {
    kind: 'skill',
    id,
    name: id,
    source: 'user',
    sourcePath: `${id}/SKILL.md`,
    hash: '',
    effective: true,
    ...values
  };
}
function asset(kind: string, status?: string): AssetRecord {
  return {
    kind,
    status,
    role: 'world',
    sourcePath: `${kind}.md`,
    title: kind,
    aliases: [],
    frontmatter: {},
    links: [],
    contentHash: '',
    updatedAt: '',
    sizeBytes: 0,
    chars: 0,
    excerpt: '',
    backlinks: []
  };
}
describe('dynamic content options', () => {
  it('uses effective content and preserves unavailable references', () => {
    const options = contentOptions(
      'skill',
      [
        entry('old', { effective: false }),
        entry('archived', { archived: true }),
        entry('current', { name: '当前技能' }),
        entry('another', { kind: 'persona' })
      ],
      ['missing', 'archived']
    );
    expect(options).toEqual([
      { value: 'archived', label: 'archived', detail: '不可用', available: false },
      { value: 'current', label: '当前技能', detail: 'current', available: true },
      { value: 'missing', label: 'missing', detail: '不可用', available: false }
    ]);
  });
  it('merges template types, live asset types and existing custom field targets', () => {
    const entries = [
      entry('custom', { kind: 'template', targetKind: 'artifact' }),
      entry('old', { kind: 'template', targetKind: 'ignored', archived: true }),
      entry('override', { kind: 'template', targetKind: 'covered', effective: false })
    ];
    const options = contentKindOptions(
      entries,
      [asset('location'), asset('ignored-asset', 'archived')],
      ['lost-kind', 'artifact', '']
    );
    expect(options.map(option => option.value)).toEqual(['artifact', 'location', 'lost-kind']);
    expect(contentKindOptions([], [])).toEqual([]);
  });
});
