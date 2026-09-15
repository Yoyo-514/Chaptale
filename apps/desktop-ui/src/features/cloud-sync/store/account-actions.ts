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
        // 作者自己按的取消不是错误；超时与拒绝才是需要看见的结局。
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
  async cancelSignIn(this: CloudSyncStoreContext) {
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
    this.browseProvider = provider;
    this.isListingLoading = true;
    this.listingError = '';
    try {
      const result = await getDesktopApi().cloudSync.listFolders({ provider, parentId });
      if (!result.ok) {
        this.listing = null;
        this.listingError = result.message;
        return;
      }
      this.listing = { current: result.current, parentId: result.parentId, folders: result.folders };
    } catch (error) {
      this.listing = null;
      this.listingError = toErrorMessage(error);
    } finally {
      this.isListingLoading = false;
    }
  },
  closeFolder(this: CloudSyncStoreContext) {
    this.browseProvider = null;
    this.listing = null;
    this.listingError = '';
  }
};
