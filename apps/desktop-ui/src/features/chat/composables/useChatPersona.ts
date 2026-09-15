import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';

import { useContentStore } from '@/features/content';
import { useNotificationStore } from '@/features/notifications';
import { useSessionStore } from '@/features/sessions';
import { useSettingsStore } from '@/features/settings';
import { useWorkbenchStore } from '@/features/workbench';

/** 没有会话时的默认身份：与主进程内置专员一致。 */
const DEFAULT_PERSONA_ID = 'companion';
/** 选择器底部「管理专员」的哨兵值，不会作为专员 id 落盘。 */
export const MANAGE_PERSONA_OPTION = '__manage';

export interface PersonaOption {
  id: string;
  name: string;
}

/**
 * 专员清单来自内容目录。清单尚未载入、或专员已被停用/删除时，把当前身份补进列表：
 * 否则选择器会显示空值，而当前会话真正在用的身份也就看不见了（停用后只读回放同样依赖这一项）。
 */
export function buildPersonaOptions(personas: readonly PersonaOption[], currentId: string): PersonaOption[] {
  const options = personas.map(persona => ({ id: persona.id, name: persona.name }));

  if (!options.some(persona => persona.id === currentId)) {
    options.unshift({
      id: currentId,
      name: currentId === DEFAULT_PERSONA_ID ? '创作伙伴' : `${currentId} · 不可用`
    });
  }

  return options;
}

/** 专员是会话级设置：还没有会话时按默认专员展示选择器。 */
function useCurrentPersonaId() {
  const sessionStore = useSessionStore();

  return computed(() => sessionStore.currentSession?.personaId ?? DEFAULT_PERSONA_ID);
}

/**
 * 专员决定这一轮由谁来看稿，是会话级设置：换专员等于换一位接手的人，
 * 所以切换一律新建会话，不改写已有会话。
 *
 * 已有消息的会话不能被静默弃掉，因此切换先进入待确认状态——输入区选择器、
 * 标题栏菜单、以及「新建会话」共用这一份判断，避免某个入口绕过确认。
 */
export function useChatPersona() {
  const router = useRouter();
  const sessionStore = useSessionStore();
  const content = useContentStore();
  const settings = useSettingsStore();
  const navigation = useWorkbenchStore();
  const notificationStore = useNotificationStore();

  const personaId = useCurrentPersonaId();
  const personaOptions = computed(() => buildPersonaOptions(content.chats, personaId.value));
  const isSwitching = ref(false);
  /** 待确认的目标专员；只在确认时消费。 */
  const pendingPersonaId = ref<string | null>(null);
  /**
   * 弹窗开关与「待确认目标」必须分开：AlertDialogAction 会先关弹窗再冒泡 confirm，
   * 同一个状态既当开关又当目标的话，点确认时目标已经被关闭逻辑清掉了。
   */
  const isSwitchPromptOpen = ref(false);
  /** 空会话切换没有损失，只有已经聊过的会话才需要拦一下。 */
  const hasSessionContent = computed(() => (sessionStore.currentSession?.messageCount ?? 0) > 0);
  const pendingPersonaName = computed(
    () => personaOptions.value.find(persona => persona.id === pendingPersonaId.value)?.name ?? ''
  );
  const isSwitchDisabled = computed(() => navigation.agentBusy || isSwitching.value);

  function requestSwitch(id: string) {
    if (id === MANAGE_PERSONA_OPTION) {
      settings.openPanel('content');
      return;
    }

    if (isSwitchDisabled.value) return;

    // 选回当前专员不该新建会话；选择器是受控的，这里必须自己短路。
    if (sessionStore.currentSession && id === personaId.value) return;

    if (hasSessionContent.value) {
      pendingPersonaId.value = id;
      isSwitchPromptOpen.value = true;
      return;
    }

    void createSessionWith(id);
  }

  /** 弹窗关闭（取消、Esc、遮罩）只收开关：目标专员留给 confirmSwitch 消费。 */
  function syncSwitchDialog(open: boolean) {
    isSwitchPromptOpen.value = open;
  }

  async function confirmSwitch() {
    const id = pendingPersonaId.value;
    isSwitchPromptOpen.value = false;
    pendingPersonaId.value = null;

    if (id) await createSessionWith(id);
  }

  /**
   * 新建会话并沿用给定专员。名称按现有会话数递增，免得一串同名会话无法分辨；
   * companion 是默认专员，不写进会话元数据。
   */
  async function createSessionWith(id: string) {
    if (isSwitchDisabled.value) return;

    // 走到建会话这一步，上一次可能被取消的待确认目标就不再适用了。
    pendingPersonaId.value = null;
    isSwitching.value = true;

    try {
      const index = sessionStore.sessions.length + 1;
      await sessionStore.createSession({
        name: `新会话 ${index}`,
        ...(id !== DEFAULT_PERSONA_ID ? { personaId: id } : {})
      });
      await router.push({ name: 'chat' });
    } catch (cause) {
      notificationStore.error('创建会话失败', cause instanceof Error ? cause.message : String(cause));
    } finally {
      isSwitching.value = false;
    }
  }

  return {
    personaId,
    personaOptions,
    isSwitchDisabled,
    pendingPersonaId,
    pendingPersonaName,
    isSwitchPromptOpen,
    requestSwitch,
    syncSwitchDialog,
    confirmSwitch,
    createSessionWith
  };
}
