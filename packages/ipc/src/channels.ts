/**
 * Renderer 与主进程共享的频道唯一来源。
 * 按业务域分组可让 Preload、handler 注册和契约审查使用同一组不可变字面量。
 */
export const IPC_CHANNELS = {
  settlement: {
    list: 'settlement:list',
    unsettled: 'settlement:unsettled',
    prepare: 'settlement:prepare',
    start: 'settlement:start',
    read: 'settlement:read',
    cancel: 'settlement:cancel',
    resolve: 'settlement:resolve',
    complete: 'settlement:complete'
  },
  templates: {
    list: 'templates:list',
    create: 'templates:create',
    identify: 'templates:identify'
  },
  reviews: {
    run: 'reviews:run',
    cancel: 'reviews:cancel',
    list: 'reviews:list',
    read: 'reviews:read',
    resolve: 'reviews:resolve'
  },
  writing: {
    generate: 'writing:generate',
    prepareRewrite: 'writing:prepare-rewrite',
    rewrite: 'writing:rewrite',
    cancel: 'writing:cancel',
    listCandidates: 'writing:list-candidates',
    readCandidate: 'writing:read-candidate',
    discard: 'writing:discard',
    apply: 'writing:apply',
    listVersions: 'writing:list-versions',
    readVersion: 'writing:read-version',
    finalizeChapter: 'writing:finalize-chapter',
    restoreVersion: 'writing:restore-version'
  },
  library: {
    sceneReferences: 'library:scene-references',
    listAssets: 'library:list-assets',
    resolveLink: 'library:resolve-link',
    composePack: 'library:compose-pack',
    freezePack: 'library:freeze-pack',
    readPack: 'library:read-pack',
    checkPack: 'library:check-pack'
  },
  workspace: {
    getState: 'workspace:get-state',
    listDirectory: 'workspace:list-directory',
    createEntry: 'workspace:create-entry',
    readDocument: 'workspace:read-document',
    writeDocument: 'workspace:write-document',
    getLayout: 'workspace:get-layout',
    createChapter: 'workspace:create-chapter',
    changed: 'workspace:changed',
    listRecoveries: 'workspace:list-recoveries',
    readRecovery: 'workspace:read-recovery',
    saveRecovery: 'workspace:save-recovery',
    discardRecovery: 'workspace:discard-recovery'
  },
  app: {
    getPlatform: 'app:get-platform'
  },
  window: {
    minimize: 'window:minimize',
    toggleMaximize: 'window:toggle-maximize',
    close: 'window:close',
    completeClose: 'window:complete-close',
    closeRequested: 'window:close-requested',
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
    updateWebTools: 'settings:update-web-tools',
    selectWorkspaceDir: 'settings:select-workspace-dir',
    openConfigDir: 'settings:open-config-dir'
  },
  promptSettings: {
    getState: 'prompt-settings:get-state',
    update: 'prompt-settings:update'
  },
  tasks: {
    run: 'tasks:run',
    cancel: 'tasks:cancel',
    listRuns: 'tasks:list-runs',
    readRunOutput: 'tasks:read-run-output'
  },
  todos: {
    get: 'todos:get',
    updated: 'todos:updated'
  },
  subagent: {
    listActive: 'subagent:list-active',
    cancel: 'subagent:cancel',
    event: 'subagent:event'
  },
  memory: {
    listPending: 'memory:list-pending',
    inspectPending: 'memory:inspect-pending',
    resolvePending: 'memory:resolve-pending',
    pendingChanged: 'memory:pending-changed'
  },
  permissions: {
    pending: 'permissions:pending',
    decide: 'permissions:decide',
    listRules: 'permissions:list-rules',
    removeRule: 'permissions:remove-rule',
    ask: 'permissions:ask'
  },
  slashCommands: {
    list: 'slash-commands:list'
  },
  models: {
    list: 'models:list',
    setDefault: 'models:set-default',
    fetchCustomProviderModels: 'models:fetch-custom-provider-models',
    addCustomProvider: 'models:add-custom-provider',
    addCustomModel: 'models:add-custom-model',
    setCustomProviderApiKey: 'models:set-custom-provider-api-key',
    removeCustomProviderApiKey: 'models:remove-custom-provider-api-key',
    updateCustomModelInput: 'models:update-custom-model-input',
    removeCustomModel: 'models:remove-custom-model'
  },
  agent: {
    selectContextFiles: 'agent:select-context-files',
    inspectContextFiles: 'agent:inspect-context-files',
    start: 'agent:start',
    steer: 'agent:steer',
    clearPendingMessages: 'agent:clear-pending-messages',
    getContextPressure: 'agent:get-context-pressure',
    compactSession: 'agent:compact-session',
    cancel: 'agent:cancel',
    message: 'agent:message',
    end: 'agent:end'
  }
} as const;

export type IpcChannelGroup = typeof IPC_CHANNELS;
