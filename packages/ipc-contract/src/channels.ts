export const IPC_CHANNELS = {
  app: {
    getPlatform: 'app:get-platform'
  },
  window: {
    minimize: 'window:minimize',
    toggleMaximize: 'window:toggle-maximize',
    close: 'window:close',
    isMaximized: 'window:is-maximized'
  },
  session: {
    list: 'session:list',
    create: 'session:create',
    getEntries: 'session:get-entries',
    getMessages: 'session:get-messages',
    rename: 'session:rename',
    delete: 'session:delete',
    setLeaf: 'session:set-leaf',
    getStorageDebugInfo: 'session:get-storage-debug-info',
    openStorageDir: 'session:open-storage-dir'
  },
  agent: {
    getHistory: 'agent:get-history',
    start: 'agent:start',
    cancel: 'agent:cancel',
    message: 'agent:message',
    done: 'agent:done',
    error: 'agent:error'
  }
} as const;

export type IpcChannelGroup = typeof IPC_CHANNELS;
