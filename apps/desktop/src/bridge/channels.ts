/** Electron 通道由平台桥接持有，业务契约保持跨端可用。 */
export const APPLICATION_HOST_CHANNELS = {
  agent: { request: 'agent-host:request', event: 'agent-host:event' },
  creation: { request: 'creation:request', event: 'creation:event', selectPaths: 'creation:select-paths' },
  disconnected: 'application-host:disconnected'
} as const;

export interface HostChannels {
  request: string;
  event: string;
}

/** Renderer 与主进程共享的平台频道，按业务域分组。 */
export const IPC_CHANNELS = {
  cloudSync: {
    getState: 'cloud-sync:get-state',
    beginAuth: 'cloud-sync:begin-auth',
    cancelAuth: 'cloud-sync:cancel-auth',
    signOut: 'cloud-sync:sign-out',
    listFolders: 'cloud-sync:list-folders'
  },
  app: {
    getPlatform: 'app:get-platform',
    editCommand: 'app:edit-command'
  },
  window: {
    zoom: 'window:zoom',
    minimize: 'window:minimize',
    toggleMaximize: 'window:toggle-maximize',
    close: 'window:close',
    completeClose: 'window:complete-close',
    closeRequested: 'window:close-requested',
    isMaximized: 'window:is-maximized'
  },
  settings: {
    getState: 'settings:get-state',
    update: 'settings:update',
    openConfigDir: 'settings:open-config-dir'
  }
} as const;
