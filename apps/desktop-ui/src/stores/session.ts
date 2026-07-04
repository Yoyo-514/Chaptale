import type { ChatMessage } from '@chaptale/shared';
import type {
  ChaptaleSessionListItem,
  ChaptaleSessionStorageDebugInfo,
  CreateSessionOptions
} from '@chaptale/ipc-contract';
import { defineStore } from 'pinia';

import { getDesktopApi, toErrorMessage } from './utils/desktop-api';

export const useSessionStore = defineStore('session', {
  state: () => ({
    sessions: [] as ChaptaleSessionListItem[],
    currentSessionId: '',
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
        this.sessions = await getDesktopApi().session.list();
        if (!this.currentSessionId && this.sessions[0]) {
          this.currentSessionId = this.sessions[0].id;
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

      const session = await this.createSession({ name: '默认会话' });
      return session.id;
    },

    async createSession(options: CreateSessionOptions = {}) {
      this.error = '';
      const session = await getDesktopApi().session.create(options);
      this.currentSessionId = session.id;
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
        }

        await this.loadSessions();
      } catch (error) {
        this.error = toErrorMessage(error);
      }
    },

    async deleteSessions(sessionIds: string[]) {
      this.error = '';
      const ids = [...new Set(sessionIds)];

      if (ids.length === 0) {
        return;
      }

      try {
        await getDesktopApi().session.deleteMany(ids);
        this.sessions = this.sessions.filter(session => !ids.includes(session.id));

        if (ids.includes(this.currentSessionId)) {
          this.currentSessionId = this.sessions[0]?.id ?? '';
        }

        await this.loadSessions();
      } catch (error) {
        this.error = toErrorMessage(error);
      }
    },

    async selectSession(sessionId: string) {
      this.currentSessionId = sessionId;
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

    async getCurrentMessages(): Promise<ChatMessage[]> {
      const sessionId = await this.ensureActiveSession();
      return getDesktopApi().agent.getHistory(sessionId);
    }
  }
});
