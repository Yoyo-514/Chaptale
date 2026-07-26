import { defineStore } from 'pinia';
import { unique } from 'radash';

import type {
  ChaptaleSessionListItem,
  ChaptaleSessionStorageDebugInfo,
  ChaptaleSessionTreeEntry,
  CreateSessionOptions
} from '@chaptale/ipc-contract';

import { getDesktopApi, toErrorMessage } from '@/utils/desktop-api';
import { isSameWorkspacePath } from '@/utils/workspace-path';

/**
 * 按 store 实例记录在途的会话列表请求。
 * 放在模块级而非 pinia state：Promise 不可序列化，进 state 会带来 devtools 噪声与 $reset 语义问题。
 */
const sessionListRequests = new WeakMap<object, Promise<boolean>>();

/**
 * Renderer 的会话目录与当前选择事实源。
 * 消息树仍按需从主进程读取；store 只缓存列表、选择和存储调试信息，避免长期复制完整会话内容。
 */
export const useSessionStore = defineStore('session', {
  state: () => ({
    sessions: [] as ChaptaleSessionListItem[],
    currentSessionId: '',
    /** 当前 workspace 的权威 cwd，由 Settings Main 返回；为空时沿用全量历史选择。 */
    activeCwd: '',
    selectionRestored: false,
    storageDebugInfo: undefined as ChaptaleSessionStorageDebugInfo | undefined,
    isLoading: false,
    error: ''
  }),
  getters: {
    currentSession(state) {
      return state.sessions.find(session => session.id === state.currentSessionId);
    },
    cwdSessions(state) {
      return state.activeCwd
        ? state.sessions.filter(session => isSameWorkspacePath(session.cwd, state.activeCwd))
        : state.sessions;
    }
  },
  actions: {
    async loadSessions() {
      // 并发调用共享同一次在途请求，避免快速切换 workspace 时后发先至覆盖列表。
      const inFlight = sessionListRequests.get(this);

      if (inFlight) {
        return inFlight;
      }

      const request = this.doLoadSessions().finally(() => {
        sessionListRequests.delete(this);
      });
      sessionListRequests.set(this, request);
      return request;
    },

    async doLoadSessions() {
      this.isLoading = true;
      this.error = '';

      try {
        const desktopApi = getDesktopApi();
        this.sessions = await desktopApi.session.list();
        const candidates = this.cwdSessions;

        if (!this.selectionRestored) {
          // 首次加载才读取持久化选择；之后刷新列表必须保留用户在当前运行期刚完成的切换。
          const persistedSessionId = await desktopApi.settings
            .getState()
            .then(state => state.settings.lastSessionId ?? '')
            .catch(() => '');
          const candidateId = this.currentSessionId || persistedSessionId;
          this.currentSessionId = candidates.some(session => session.id === candidateId)
            ? candidateId
            : (candidates[0]?.id ?? '');
          this.selectionRestored = true;

          if (this.currentSessionId !== persistedSessionId) {
            await this.persistCurrentSession();
          }
        } else if (!this.sessions.some(session => session.id === this.currentSessionId)) {
          // 只有当前选择确实不存在时才回退；显式选择的跨 workspace/global 会话必须保留。
          this.currentSessionId = candidates[0]?.id ?? '';
          await this.persistCurrentSession();
        }

        return true;
      } catch (error) {
        this.error = toErrorMessage(error);
        return false;
      } finally {
        this.isLoading = false;
      }
    },

    async ensureActiveSession() {
      const loaded = await this.loadSessions();
      if (!loaded) {
        // 加载失败与成功空列表必须区分；失败时创建新会话会把真实错误伪装成空状态。
        throw new Error(this.error || '会话列表加载失败');
      }

      if (this.currentSessionId && this.currentSession) {
        return this.currentSessionId;
      }

      const session = await this.createSession({ name: '新会话' });
      return session.id;
    },

    async bindCwd(cwd: string) {
      this.activeCwd = cwd;
      // 绑定新 cwd 后旧选择不再可信；加载失败也不能重新暴露旧 workspace 的会话。
      this.currentSessionId = '';
      const loaded = await this.loadSessions();

      if (!loaded) {
        throw new Error(this.error || '会话列表加载失败');
      }
    },

    async createSession(options: CreateSessionOptions = {}) {
      this.error = '';
      const session = await getDesktopApi().session.create(options);
      this.currentSessionId = session.id;
      await this.persistCurrentSession();
      await this.loadSessions();
      return session;
    },

    async deleteSession(sessionId: string) {
      this.error = '';
      const deletedCurrentSession = this.currentSessionId === sessionId;

      try {
        await getDesktopApi().session.delete(sessionId);
        this.sessions = this.sessions.filter(session => session.id !== sessionId);

        if (deletedCurrentSession) {
          this.currentSessionId = this.cwdSessions[0]?.id ?? '';
          await this.persistCurrentSession();
        }

        await this.loadSessions();
      } catch (error) {
        this.error = toErrorMessage(error);
      }
    },

    async deleteSessions(sessionIds: string[]) {
      this.error = '';
      const ids = unique(sessionIds);

      if (ids.length === 0) {
        return;
      }

      try {
        await getDesktopApi().session.deleteMany(ids);
        this.sessions = this.sessions.filter(session => !ids.includes(session.id));

        if (ids.includes(this.currentSessionId)) {
          this.currentSessionId = this.cwdSessions[0]?.id ?? '';
          await this.persistCurrentSession();
        }

        await this.loadSessions();
      } catch (error) {
        this.error = toErrorMessage(error);
      }
    },

    async selectSession(sessionId: string) {
      this.currentSessionId = sessionId;
      await this.persistCurrentSession();
    },

    async persistCurrentSession() {
      try {
        await getDesktopApi().settings.update({ lastSessionId: this.currentSessionId || null });
      } catch {
        // 会话切换本身不应因偏好持久化失败而中断。
      }
    },

    async renameSession(sessionId: string, name: string) {
      this.error = '';
      const trimmed = name.trim();

      if (!trimmed) {
        return;
      }

      try {
        await getDesktopApi().session.rename(sessionId, trimmed);
        await this.loadSessions();
      } catch (error) {
        this.error = toErrorMessage(error);
      }
    },

    /** 返回导出文件路径；用户取消或失败时返回 null。 */
    async exportSessionHtml(sessionId: string) {
      this.error = '';

      try {
        return await getDesktopApi().session.exportHtml(sessionId);
      } catch (error) {
        this.error = toErrorMessage(error);
        return null;
      }
    },

    async loadStorageDebugInfo() {
      this.error = '';

      try {
        this.storageDebugInfo = await getDesktopApi().session.getStorageDebugInfo();
      } catch (error) {
        this.error = toErrorMessage(error);
      }
    },

    async openStorageDir() {
      this.error = '';

      try {
        await getDesktopApi().session.openStorageDir();
      } catch (error) {
        this.error = toErrorMessage(error);
      }
    },

    async getCurrentEntries(): Promise<ChaptaleSessionTreeEntry[]> {
      const sessionId = await this.ensureActiveSession();
      return getDesktopApi().session.getEntries(sessionId);
    },

    async setCurrentLeaf(leafId: string | null) {
      const sessionId = await this.ensureActiveSession();
      await getDesktopApi().session.setLeaf(sessionId, leafId);
      await this.loadSessions();
    }
  }
});
