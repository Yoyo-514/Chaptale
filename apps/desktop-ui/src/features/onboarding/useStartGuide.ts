import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';

import type { WorkspaceDocument } from '@chaptale/ipc-contract';

import { useEditorStore } from '@/features/editor';
import { useNotificationStore } from '@/features/notifications';
import { useSessionStore } from '@/features/sessions';
import { useWorkbenchStore } from '@/features/workbench';
import { useWorkspaceStore } from '@/features/workspace';
import { toErrorMessage } from '@/utils/desktop-api';

/**
 * 长篇的第一步不是写正文，而是先让作者把故事想清楚。
 *
 * 措辞用作者自己的口吻（“我要写…”），不把他描述成新手——预填的话越像他本人说的，访谈越容易问对问题。
 * 冒号后留一处空行给作者填念头；第二句把“理清楚”具体到 `blueprint-interview` 技能的四轮，
 * 让专员直接从题材与冲突问起，而不是先反问“你想让我做什么”；第三句把写正文推开，
 * 与那个技能“访谈中不产出正文”的约束一致。
 */
export const START_GUIDE_PROMPT = [
  '我要写：______',
  '先陪我把这个故事理清楚，暂时不用动笔。',
  '题材、核心冲突、主角的欲望与缺陷、结局方向，我都想先定下来。'
].join('\n');

/** 承载第一步的会话名；新建作品后第一次进入正文就该看到它。 */
export const START_GUIDE_SESSION_NAME = '理清这个故事';

/** 首章还空着时才值得提示：作品存在、当前是章节、一个字没写、这个作品也还没有开始过。 */
export function shouldOfferStartGuide(input: {
  hasWorkspace: boolean;
  isChapter: boolean;
  words: number;
  hasStarted: boolean;
}): boolean {
  return input.hasWorkspace && input.isChapter && input.words === 0 && !input.hasStarted;
}

/**
 * 「第一步」的判定与动作。
 *
 * 只负责把作者送进「故事策划」的对话并预填话术，不代发消息——
 * 发不发、怎么改这句话都由作者决定，界面上它只是"帮我把话说了一半"。
 */
export function useStartGuide(getDocument: () => WorkspaceDocument | undefined) {
  const editor = useEditorStore();
  const sessions = useSessionStore();
  const workspace = useWorkspaceStore();
  const navigation = useWorkbenchStore();
  const notification = useNotificationStore();
  const router = useRouter();
  const isStarting = ref(false);

  const shouldShow = computed(() => {
    const document = getDocument();
    const active = editor.activeTab;
    // 字数只在当前渲染的文档就是活动标签时才可信，否则会读到别的标签的旧值。
    const words = active && document && active.path === document.relativePath ? (active.words ?? 0) : 0;

    return shouldOfferStartGuide({
      hasWorkspace: Boolean(workspace.rootPath),
      isChapter: document?.head.status === 'ok' && document.head.frontmatter.kind === 'chapter',
      words,
      // 已经开始过就不再提示：有过助手回复，或作者已经被送去和故事策划聊过。
      hasStarted: sessions.sessions.some(session => session.messageCount > 0 || session.personaId === 'blueprint')
    });
  });

  async function start() {
    const rootPath = workspace.rootPath;
    if (isStarting.value || !rootPath) return;
    isStarting.value = true;
    try {
      // 重复点击不另开会话：空的「故事策划」会话已经存在时直接复用它。
      const current = sessions.currentSession;
      if (current?.personaId !== 'blueprint' || current.messageCount > 0) {
        await sessions.createSession({ name: START_GUIDE_SESSION_NAME, personaId: 'blueprint' });
      }
      await router.push({ name: 'chat' });
      navigation.askAgent(rootPath, START_GUIDE_PROMPT);
    } catch (cause) {
      notification.error('无法开始理清故事', toErrorMessage(cause));
    } finally {
      isStarting.value = false;
    }
  }

  return { shouldShow, isStarting, start };
}
