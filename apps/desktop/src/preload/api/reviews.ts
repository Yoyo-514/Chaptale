import { ipcRenderer } from 'electron';

import { IPC_CHANNELS, type ReviewsApi } from '@chaptale/ipc-contract';
export function createReviewsApi(): ReviewsApi {
  return {
    run: args => ipcRenderer.invoke(IPC_CHANNELS.reviews.run, args),
    cancel: args => ipcRenderer.invoke(IPC_CHANNELS.reviews.cancel, args),
    list: args => ipcRenderer.invoke(IPC_CHANNELS.reviews.list, args),
    read: args => ipcRenderer.invoke(IPC_CHANNELS.reviews.read, args),
    resolve: args => ipcRenderer.invoke(IPC_CHANNELS.reviews.resolve, args)
  };
}
