import { describe, expect, it } from 'vitest';

import {
  archiveFileName,
  createMarker,
  isArchiveFileName,
  parseMarker,
  sanitizeName,
  serializeMarker,
  timestamp
} from '../remote-layout';

describe('远端布局', () => {
  it('归档名带作品名、设备名与到秒的时间戳', () => {
    const name = archiveFileName({
      title: '拾光之城',
      deviceName: 'DESKTOP-8KQ2M1P',
      at: new Date(2026, 8, 13, 21, 4, 5)
    });

    expect(name).toBe('拾光之城 DESKTOP-8KQ2M1P 20260913-210405.zip');
    expect(timestamp(new Date(2026, 0, 2, 3, 4, 5))).toBe('20260102-030405');
  });
  it('清洗远端与本地都不能出现的字符，空名回落为未命名', () => {
    expect(sanitizeName('a/b\\c:d*e?f"g<h>i|j')).toBe('a_b_c_d_e_f_g_h_i_j');
    expect(sanitizeName('多  空格\n换行')).toBe('多 空格换行');
    expect(sanitizeName('...')).toBe('未命名');
    expect(sanitizeName('   ')).toBe('未命名');
    expect(sanitizeName('x'.repeat(200))).toHaveLength(120);
  });
  it('作品名里的斜杠不会把归档写出备份目录', () => {
    const name = archiveFileName({ title: '../逃逸', deviceName: 'pc', at: new Date(2026, 8, 13) });

    expect(name).not.toContain('/');
    expect(name).not.toContain('..');
  });
  it('身份标记可往返，坏输入一律判为不可用', () => {
    const marker = createMarker({ workspaceId: 'w-8f3a', title: '拾光之城' });

    expect(parseMarker(serializeMarker(marker))).toEqual(marker);

    for (const broken of [
      '',
      '{}',
      'null',
      '[]',
      '1',
      '"text"',
      'not json',
      '{"version":2,"workspaceId":"w"}',
      '{"version":1,"workspaceId":""}'
    ]) {
      expect(parseMarker(broken)).toBeNull();
    }
  });
  it('只把 zip 当归档，备份目录里的其他文件不进清单', () => {
    expect(isArchiveFileName('a.zip')).toBe(true);
    expect(isArchiveFileName('A.ZIP')).toBe(true);
    expect(isArchiveFileName('笔记.md')).toBe(false);
  });
});
