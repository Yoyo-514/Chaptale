import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createSkillTemplate, scanManagedSkills } from '../../skills/index.ts';
import { decodeUserPrompt, encodeUserPrompt } from '../user-prompt.ts';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'chaptale-user-prompt-'));
  dirs.push(dir);
  return dir;
}

describe('user prompt', () => {
  it('展开 /skill:名称 并与编辑器定位上下文无损往返，停用或未知技能不展开', async () => {
    const root = await tempDir();
    const globalDir = join(root, 'global-skills');
    await createSkillTemplate({
      rootDir: globalDir,
      name: 'beat-sheet',
      description: '剧本节拍表',
      disableModelInvocation: true
    });
    // 模拟 Windows CRLF 保存的 SKILL.md
    await writeFile(
      join(globalDir, 'beat-sheet', 'SKILL.md'),
      '---\r\nname: beat-sheet\r\ndescription: 剧本节拍表\r\ndisable-model-invocation: true\r\n---\r\n\r\n按五幕拆解场次。\r\n',
      'utf8'
    );
    const { enabledSkills } = scanManagedSkills({
      globalDir,
      disabledGlobal: [],
      workDir: null,
      disabledWork: []
    });

    const context = {
      workId: 'w-1',
      entryId: 'e-1',
      title: '第四章',
      section: 'manuscript' as const,
      selection: '风雪夜归人'
    };
    const encoded = await encodeUserPrompt('/skill:beat-sheet 拆成五场夜戏', context, 'w-1', enabledSkills);
    expect(encoded).toContain('<editor_context>');
    expect(encoded).toContain('<skill name="beat-sheet"');
    expect(encoded).toContain('按五幕拆解场次。');

    const decoded = decodeUserPrompt(encoded);
    expect(decoded).toEqual({
      text: '拆成五场夜戏',
      skill: { name: 'beat-sheet' },
      editorContext: context
    });

    // 未知或停用技能保持原文本透传
    const untouched = await encodeUserPrompt('/skill:missing 试试', undefined, null, enabledSkills);
    expect(untouched).toBe('/skill:missing 试试');
  });
});
