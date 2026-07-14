import type { ChatContextFile } from '@chaptale/shared';
import { describe, expect, it } from 'vitest';

import { getDroppedContextFilePaths, mergeChatContextFiles } from '../../utils/context-files';

function textFile(path: string): ChatContextFile {
  return { path, name: path.split('/').at(-1) ?? path, size: 1, kind: 'text' };
}

describe('context file utils', () => {
  it('merges selected files by path while preserving first occurrence order', () => {
    expect(
      mergeChatContextFiles([textFile('/a.ts'), textFile('/b.ts')], [textFile('/b.ts'), textFile('/c.ts')])
    ).toEqual([textFile('/a.ts'), textFile('/b.ts'), textFile('/c.ts')]);
  });

  it('filters empty paths from dropped files', () => {
    const files = [{ name: 'a.ts' }, { name: 'ignored' }, { name: 'b.ts' }] as File[];

    expect(getDroppedContextFilePaths(files, file => (file.name === 'ignored' ? '' : `/tmp/${file.name}`))).toEqual([
      '/tmp/a.ts',
      '/tmp/b.ts'
    ]);
  });
});
