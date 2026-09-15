import type { CloudProvider } from '@chaptale/ipc-contract';

import { getDesktopApi, toErrorMessage } from '@/utils/desktop-api';

import type { CloudSyncStoreContext } from './types';

export const cloudAccountActions = {
  async load(this: CloudSyncStoreContext) {
    this.isLoading = true;
    this.error = '';
    try {
      this.state = await getDesktopApi().cloudSync.getState();
    } catch (error) {
      this.error = toErrorMessage(error);
    } finally {
      this.isLoading = false;
    }
  },

  async signIn(this: CloudSyncStoreContext, provider: CloudProvider) {
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
    } catch (error) {
      this.error = toErrorMessage(error);
    } finally {
      this.busy = null;
    }
  },

  async cancelSignIn() {
    await getDesktopApi().cloudSync.cancelAuth();
  },

  async signOut(this: CloudSyncStoreContext, provider: CloudProvider) {
    if (this.busy) return;
    this.busy = provider;
    this.error = '';
    try {
      this.state = await getDesktopApi().cloudSync.signOut({ provider });
      if (this.browseProvider === provider) this.closeFolder();
      if (this.binding?.provider === provider) await this.loadBackups();
    } catch (error) {
      this.error = toErrorMessage(error);
    } finally {
      this.busy = null;
    }
  },

  async openFolder(this: CloudSyncStoreContext, provider: CloudProvider, parentId: string | null) {
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
    } catch (error) {
      if (request === this.folderRequest) this.listingError = toErrorMessage(error);
    } finally {
      if (request === this.folderRequest) this.isListingLoading = false;
    }
  },

  closeFolder(this: CloudSyncStoreContext) {
    ++this.folderRequest;
    this.browseProvider = null;
    this.listing = null;
    this.listingError = '';
    this.isListingLoading = false;
  }
};
