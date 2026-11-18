import {
  createAssistantMessageEventStream,
  getSystemMessageText,
  InMemoryCredentialStore,
  type Context
} from '@earendil-works/pi-ai';
import {
  createLsToolDefinition,
  createReadToolDefinition,
  defineTool,
  ModelRuntime
} from '@earendil-works/pi-coding-agent';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { EditorContext, ManagedSkillView, ManagedSkillsSnapshot, SessionSkillItem } from '../../protocol/index.ts';
import { EmbeddingConfiguration } from '../../retrieval/config.ts';
import { HostModelConfiguration } from '../../runtime/model-configuration.ts';
import { HostApplication } from '../index.ts';

const zeroUsage = {
  input: 10,
  output: 5,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 15,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
};

type ScriptTurn =
  | { kind: 'text'; text: string }
  | { kind: 'toolCall'; id: string; name: string; arguments: Record<string, string>; pause?: Promise<void> };

describe('HostApplication skills integration', () => {
  let root: string;
  let app: HostApplication;
  let contexts: Context[];
  let scriptQueue: ScriptTurn[];

  const modelRef = { provider: 'skills-test', id: 'scripted-model' };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'chaptale-host-skills-'));
    for (const sub of ['agent', 'sessions', 'cwd', 'data']) {
      await mkdir(join(root, sub), { recursive: true });
    }
    contexts = [];
    scriptQueue = [];

    const runtime = await ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      modelsPath: null,
      allowModelNetwork: false,
      refreshOnCreate: false
    });
    runtime.registerProvider(modelRef.provider, {
      baseUrl: 'http://127.0.0.1:9',
      apiKey: 'offline-key',
      api: 'skills-scripted-api',
      models: [
        {
          id: modelRef.id,
          name: '脚本离线模型',
          reasoning: false,
          input: ['text'],
          contextWindow: 16384,
          maxTokens: 1024,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
        }
      ],
      streamSimple: (target, context) => {
        contexts.push(structuredClone(context));
        const step = scriptQueue.shift() ?? { kind: 'text', text: '收到' };
        const stream = createAssistantMessageEventStream();
        void (async () => {
          if (step.kind === 'toolCall' && step.pause) await step.pause;
          const content =
            step.kind === 'toolCall'
              ? [{ type: 'toolCall' as const, id: step.id, name: step.name, arguments: step.arguments }]
              : [{ type: 'text' as const, text: step.text }];
          const message = {
            role: 'assistant' as const,
            content,
            api: target.api,
            provider: target.provider,
            model: target.id,
            usage: zeroUsage,
            stopReason: step.kind === 'toolCall' ? ('toolUse' as const) : ('stop' as const),
            timestamp: Date.now()
          };
          stream.push({ type: 'start', partial: message });
          stream.push({ type: 'done', reason: message.stopReason, message });
        })();
        return stream;
      }
    });

    app = await HostApplication.create({
      cwd: join(root, 'cwd'),
      agentDir: join(root, 'agent'),
      sessionDir: join(root, 'sessions'),
      settingsFile: join(root, 'data', 'settings.json'),
      builtinInstructions: [{ name: '主创', role: 'system', text: '主创系统指令', enabled: true }],
      modelRuntime: runtime,
      modelConfiguration: new HostModelConfiguration(join(root, 'data'), runtime),
      embeddingConfiguration: new EmbeddingConfiguration(join(root, 'data')),
      tools: cwd => [defineTool(createReadToolDefinition(cwd)), defineTool(createLsToolDefinition(cwd))]
    });
  });

  afterEach(async () => {
    await app.dispose();
    await rm(root, { recursive: true, force: true });
  });

  function combinedSystemText(ctx: Context): string {
    const parts = [ctx.systemPrompt ?? ''];
    for (const msg of ctx.messages) {
      if (msg.role === 'system') parts.push(getSystemMessageText(msg));
    }
    return parts.join('\n');
  }

  async function waitIdle(id: string): Promise<void> {
    await expect.poll(() => app.snapshot().sessions.find(s => s.id === id)?.running).toBe(false);
  }

  it('空闲发送前重扫增量更新 <skills>，手动专用技能仅进补全不进自动索引，修改描述实时生效', async () => {
    await app.execute({
      method: 'createSkill',
      input: {
        scope: 'global',
        workId: null,
        name: 'polish-prose',
        description: '全局文风润色检查'
      }
    });
    await app.execute({
      method: 'createSkill',
      input: {
        scope: 'global',
        workId: null,
        name: 'manual-audit',
        description: '重度全书一致性审计',
        disableModelInvocation: true
      }
    });

    const sessionId = (await app.execute({
      method: 'create',
      input: { model: modelRef, workId: null }
    })) as string;

    const items = (await app.execute({ method: 'sessionSkills', input: { id: sessionId } })) as SessionSkillItem[];
    expect(items.map(i => ({ name: i.name, manual: i.disableModelInvocation }))).toEqual([
      { name: 'manual-audit', manual: true },
      { name: 'polish-prose', manual: false }
    ]);

    await app.execute({ method: 'prompt', input: { id: sessionId, text: '第一轮问候' } });
    await waitIdle(sessionId);
    const firstSys = combinedSystemText(contexts[0]!);
    expect(firstSys).toContain('<available_skills>');
    expect(firstSys).toContain('全局文风润色检查');
    expect(firstSys).not.toContain('重度全书一致性审计');

    // 会话空闲期间再新增一个全局技能，下一轮发送前自动重扫生效
    await app.execute({
      method: 'createSkill',
      input: {
        scope: 'global',
        workId: null,
        name: 'dialogue-subtext',
        description: '人物对白潜台词审读'
      }
    });
    await app.execute({ method: 'prompt', input: { id: sessionId, text: '第二轮问候' } });
    await waitIdle(sessionId);
    const secondSys = combinedSystemText(contexts[1]!);
    expect(secondSys).toContain('人物对白潜台词审读');
  });

  it('已启用 Skill 目录内 read 与 codemode 嵌套 read 自动放行并标记 skillName，停用项与越界软链弹授权，运行中请求保持锁定', async () => {
    const created = (await app.execute({
      method: 'createSkill',
      input: {
        scope: 'global',
        workId: null,
        name: 'tang-titles',
        description: '唐代官制核对'
      }
    })) as { skill: ManagedSkillView; snapshot: ManagedSkillsSnapshot };
    await mkdir(join(created.skill.baseDir, 'references'), { recursive: true });
    const refPath = join(created.skill.baseDir, 'references', 'ranks.md');
    await writeFile(refPath, '尚书令：正二品', 'utf8');

    const disabledCreated = (await app.execute({
      method: 'createSkill',
      input: {
        scope: 'global',
        workId: null,
        name: 'disabled-guide',
        description: '已停用指南'
      }
    })) as { skill: ManagedSkillView; snapshot: ManagedSkillsSnapshot };
    await app.execute({
      method: 'setSkillEnabled',
      input: { scope: 'global', workId: null, name: 'disabled-guide', enabled: false }
    });

    const sessionId = (await app.execute({
      method: 'create',
      input: { model: modelRef, workId: null }
    })) as string;

    scriptQueue.push(
      { kind: 'toolCall', id: 'tc-read-1', name: 'read', arguments: { path: refPath } },
      {
        kind: 'toolCall',
        id: 'tc-cm-1',
        name: 'codemode',
        arguments: { code: `return await tools.read({ path: ${JSON.stringify(created.skill.filePath)} });` }
      },
      { kind: 'text', text: '读取完毕' }
    );
    await app.execute({ method: 'prompt', input: { id: sessionId, text: '核对品级' } });
    await waitIdle(sessionId);
    expect(app.snapshot().approvals).toEqual([]);

    const messages = app.snapshot().sessions.find(s => s.id === sessionId)!.messages;
    const directCall = messages.flatMap(m => m.tools).find(t => t.id === 'tc-read-1');
    expect(directCall?.info?.skillName).toBe('tang-titles');
    const cmResult = messages.find(m => m.role === 'toolResult' && m.toolCallId === 'tc-cm-1');
    expect(cmResult?.error).toBe(false);
    expect(cmResult?.nestedTools?.[0]?.info?.skillName).toBe('tang-titles');

    // 运行中锁定：请求启动后在后台启用 disabled-guide，当前运行中的请求访问它仍走授权弹窗
    let resumeTurn!: () => void;
    const pause = new Promise<void>(resolve => {
      resumeTurn = resolve;
    });
    scriptQueue.push(
      {
        kind: 'toolCall',
        id: 'tc-locked',
        name: 'read',
        arguments: { path: disabledCreated.skill.filePath },
        pause
      },
      { kind: 'text', text: '结束' }
    );
    await app.execute({ method: 'prompt', input: { id: sessionId, text: '测试运行中锁定' } });
    await expect.poll(() => contexts.length).toBe(4);
    await app.execute({
      method: 'setSkillEnabled',
      input: { scope: 'global', workId: null, name: 'disabled-guide', enabled: true }
    });
    resumeTurn();
    await expect.poll(() => app.snapshot().approvals.length).toBe(1);
    await app.execute({ method: 'approve', input: { id: app.snapshot().approvals[0]!.id, allow: false } });
    await waitIdle(sessionId);

    // 越界符号链接拦截
    const outsideSecret = join(root, 'secret-outside.txt');
    await writeFile(outsideSecret, '外部隐私文件', 'utf8');
    const linkPath = join(created.skill.baseDir, 'references', 'outside-link.md');
    let linked = true;
    try {
      await symlink(outsideSecret, linkPath);
    } catch {
      linked = false;
    }
    if (linked) {
      scriptQueue.push(
        { kind: 'toolCall', id: 'tc-symlink', name: 'read', arguments: { path: linkPath } },
        { kind: 'text', text: '软链被拦' }
      );
      await app.execute({ method: 'prompt', input: { id: sessionId, text: '读取软链' } });
      await expect.poll(() => app.snapshot().approvals.length).toBe(1);
      await app.execute({ method: 'approve', input: { id: app.snapshot().approvals[0]!.id, allow: false } });
      await waitIdle(sessionId);
    }
  });

  it('/skill:名称 手动触发结合编辑器上下文展开给模型，并在会话快照与重开历史中折叠投影为 skill 标签', async () => {
    const created = (await app.execute({
      method: 'createSkill',
      input: {
        scope: 'global',
        workId: null,
        name: 'beat-sheet',
        description: '五幕场次拆解',
        disableModelInvocation: true
      }
    })) as { skill: ManagedSkillView; snapshot: ManagedSkillsSnapshot };
    await writeFile(
      created.skill.filePath,
      '---\nname: beat-sheet\ndescription: 五幕场次拆解\ndisable-model-invocation: true\n---\n严格输出五场表格。\n',
      'utf8'
    );

    const sessionId = (await app.execute({
      method: 'create',
      input: { model: modelRef, workId: null }
    })) as string;

    const editorContext: EditorContext = {
      workId: 'w-any',
      entryId: 'ch-4',
      title: '第四回',
      section: 'manuscript',
      selection: '风雪山神庙'
    };

    await app.execute({
      method: 'prompt',
      input: { id: sessionId, text: '/skill:beat-sheet 拆成五场夜戏', editorContext }
    });
    await waitIdle(sessionId);

    const sentUser = contexts[0]!.messages.find(m => m.role === 'user');
    const sentText =
      typeof sentUser?.content === 'string'
        ? sentUser.content
        : (sentUser?.content
            .filter(b => b.type === 'text')
            .map(b => b.text)
            .join('') ?? '');
    expect(sentText).toContain('<editor_context>');
    expect(sentText).toContain('<skill name="beat-sheet"');
    expect(sentText).toContain('严格输出五场表格。');
    expect(sentText).toContain('拆成五场夜戏');

    const view = app.snapshot().sessions.find(s => s.id === sessionId)!;
    const userMsg = view.messages.find(m => m.role === 'user')!;
    expect(userMsg).toMatchObject({
      text: '拆成五场夜戏',
      skill: { name: 'beat-sheet' },
      editorContext
    });

    const file = view.file;
    await app.execute({ method: 'close', input: { id: sessionId } });
    const reopenedId = (await app.execute({ method: 'open', input: { file } })) as string;
    const reopenedUser = app
      .snapshot()
      .sessions.find(s => s.id === reopenedId)!
      .messages.find(m => m.role === 'user')!;
    expect(reopenedUser).toMatchObject({
      text: '拆成五场夜戏',
      skill: { name: 'beat-sheet' },
      editorContext
    });
  });
});
