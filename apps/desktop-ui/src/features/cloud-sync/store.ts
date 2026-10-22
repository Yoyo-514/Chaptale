import { defineStore } from 'pinia';

import type { CloudProvider, CloudRemoteFolder, CloudSyncState } from '@chaptale/ipc-contract';

import { getDesktopApi, toErrorMessage } from '@/utils/desktop-api';

/** 云端账户与目录浏览；作品归档由新存储的备份流程接入。 */
export const useCloudSyncStore = defineStore('cloudSync', {
  state: () => ({
    state: null as CloudSyncState | null,
    isLoading: false,
    error: '',
    busy: null as CloudProvider | null,
    browseProvider: null as CloudProvider | null,
    listing: null as { current: CloudRemoteFolder; parentId: string | null; folders: CloudRemoteFolder[] } | null,
    isListingLoading: false,
    listingError: '',
    folderRequest: 0
  }),
  getters: {
    availability: state => state.state?.availability ?? [],
    accounts: state => state.state?.accounts ?? []
  },
  actions: {
    async load() {
      this.isLoading = true;
      this.error = '';
      try {
        this.state = await getDesktopApi().cloudSync.getState();
      } catch (cause) {
        this.error = toErrorMessage(cause);
      } finally {
        this.isLoading = false;
      }
    },
    async signIn(provider: CloudProvider) {
      if (this.busy) return;
      this.busy = provider;
      this.error = '';
      try {
        const result = await getDesktopApi().cloudSync.beginAuth({ provider });
        if (!result.ok) {
          if (result.code !== 'canceled') this.error = result.message;
          return;
        }
        await this.load();
        await this.openFolder(provider, null);
      } catch (cause) {
        this.error = toErrorMessage(cause);
      } finally {
        this.busy = null;
      }
    },
    async cancelSignIn() {
      await getDesktopApi().cloudSync.cancelAuth();
    },
    async signOut(provider: CloudProvider) {
      if (this.busy) return;
      this.busy = provider;
      this.error = '';
      try {
        this.state = await getDesktopApi().cloudSync.signOut({ provider });
        if (this.browseProvider === provider) this.closeFolder();
      } catch (cause) {
        this.error = toErrorMessage(cause);
      } finally {
        this.busy = null;
      }
    },
    async openFolder(provider: CloudProvider, parentId: string | null) {
      const request = ++this.folderRequest;
      this.browseProvider = provider;
      this.listing = null;
      this.isListingLoading = true;
      this.listingError = '';
      try {
        const result = await getDesktopApi().cloudSync.listFolders({ provider, parentId });
        if (request !== this.folderRequest) return;
        if (!result.ok) {
          this.listingError = result.message;
          return;
        }
        this.listing = { current: result.current, parentId: result.parentId, folders: result.folders };
      } catch (cause) {
        if (request === this.folderRequest) this.listingError = toErrorMessage(cause);
      } finally {
        if (request === this.folderRequest) this.isListingLoading = false;
      }
    },
    closeFolder() {
      ++this.folderRequest;
      this.browseProvider = null;
      this.listing = null;
      this.listingError = '';
      this.isListingLoading = false;
    }
  }
});
