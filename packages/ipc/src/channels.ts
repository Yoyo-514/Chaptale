/**
 * Renderer 与主进程共享的频道唯一来源。
 * 按业务域分组可让 Preload、handler 注册和契约审查使用同一组不可变字面量。
 */
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
    readImage: 'session:read-image',
    rename: 'session:rename',
    exportHtml: 'session:export-html',
    delete: 'session:delete',
    deleteMany: 'session:delete-many',
    setLeaf: 'session:set-leaf',
    getStorageDebugInfo: 'session:get-storage-debug-info',
    openStorageDir: 'session:open-storage-dir'
  },
  settings: {
    getState: 'settings:get-state',
    update: 'settings:update',
    updateWebAccess: 'settings:update-web-access',
    selectWorkspaceDir: 'settings:select-workspace-dir',
    openConfigDir: 'settings:open-config-dir'
  },
  promptSettings: {
    getState: 'prompt-settings:get-state',
    update: 'prompt-settings:update'
  },
  slashCommands: {
    list: 'slash-commands:list'
  },
  models: {
    list: 'models:list',
    setDefault: 'models:set-default',
    setProviderApiKey: 'models:set-provider-api-key',
    fetchCustomProviderModels: 'models:fetch-custom-provider-models',
    addCustomProvider: 'models:add-custom-provider',
    addCustomModel: 'models:add-custom-model',
    setCustomProviderApiKey: 'models:set-custom-provider-api-key',
    removeCustomProviderApiKey: 'models:remove-custom-provider-api-key',
    updateCustomModelInput: 'models:update-custom-model-input',
    removeCustomModel: 'models:remove-custom-model',
    removeProviderAuth: 'models:remove-provider-auth'
  },
  agent: {
    selectContextFiles: 'agent:select-context-files',
    inspectContextFiles: 'agent:inspect-context-files',
    start: 'agent:start',
    cancel: 'agent:cancel',
    message: 'agent:message',
    done: 'agent:done',
    error: 'agent:error'
  }
} as const;

export type IpcChannelGroup = typeof IPC_CHANNELS;
