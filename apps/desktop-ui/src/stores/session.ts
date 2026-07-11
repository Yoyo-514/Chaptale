import type {
  ChaptaleSessionListItem,
  ChaptaleSessionStorageDebugInfo,
  ChaptaleSessionTreeEntry,
  CreateSessionOptions
} from '@chaptale/ipc-contract';
import { defineStore } from 'pinia';
import { unique } from 'radash';

import { getDesktopApi, toErrorMessage } from './utils/desktop-api';

export const useSessionStore = defineStore('session', {
  state: () => ({
    sessions: [] as ChaptaleSessionListItem[],
    currentSessionId: '',
    selectionRestored: false,
    storageDebugInfo: undefined as ChaptaleSessionStorageDebugInfo | undefined,
    isLoading: false,
    error: ''
  }),
  getters: {
    currentSession(state) {
      return state.sessions.find(session => session.id === state.currentSessionId);
    }
  },
  actions: {
    async loadSessions() {
      this.isLoading = true;
      this.error = '';

      try {
        const desktopApi = getDesktopApi();
        this.sessions = await desktopApi.session.list();

        if (!this.selectionRestored) {
          const persistedSessionId = await desktopApi.settings
            .getState()
            .then(state => state.settings.lastSessionId ?? '')
            .catch(() => '');
          const candidateId = this.currentSessionId || persistedSessionId;
          this.currentSessionId = this.sessions.some(session => session.id === candidateId)
            ? candidateId
            : (this.sessions[0]?.id ?? '');
          this.selectionRestored = true;

          if (this.currentSessionId !== persistedSessionId) {
            await this.persistCurrentSession();
          }
        } else if (!this.sessions.some(session => session.id === this.currentSessionId)) {
          this.currentSessionId = this.sessions[0]?.id ?? '';
          await this.persistCurrentSession();
        }
      } catch (error) {
        this.error = toErrorMessage(error);
      } finally {
        this.isLoading = false;
      }
    },

    async ensureActiveSession() {
      await this.loadSessions();

      if (this.currentSessionId) {
        return this.currentSessionId;
      }

      const session = await this.createSession({ name: '新会话' });
      return session.id;
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
          this.currentSessionId = this.sessions[0]?.id ?? '';
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
          this.currentSessionId = this.sessions[0]?.id ?? '';
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
