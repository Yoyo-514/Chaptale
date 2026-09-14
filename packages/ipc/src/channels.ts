/**
 * Renderer 与主进程共享的频道唯一来源。
 * 按业务域分组可让 Preload、handler 注册和契约审查使用同一组不可变字面量。
 */
export const IPC_CHANNELS = {
  content: {
    list: 'content:list',
    read: 'content:read',
    save: 'content:save',
    archive: 'content:archive',
    restore: 'content:restore',
    previewDelete: 'content:preview-delete',
    delete: 'content:delete',
    previewExport: 'content:preview-export',
    saveExport: 'content:save-export',
    previewImport: 'content:preview-import',
    import: 'content:import'
  },
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
    resolve: 'reviews:resolve',
    feedback: 'reviews:feedback',
    resolveFeedback: 'reviews:resolve-feedback'
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
    search: 'library:search',
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
    selectParent: 'workspace:select-parent',
    createWorkspace: 'workspace:create-workspace',
    inspectEntry: 'workspace:inspect-entry',
    mutateEntry: 'workspace:mutate-entry',
    revealEntry: 'workspace:reveal-entry',
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
  cloudSync: {
    getState: 'cloud-sync:get-state',
    getBinding: 'cloud-sync:get-binding',
    beginAuth: 'cloud-sync:begin-auth',
    cancelAuth: 'cloud-sync:cancel-auth',
    signOut: 'cloud-sync:sign-out',
    listFolders: 'cloud-sync:list-folders',
    bind: 'cloud-sync:bind',
    unbind: 'cloud-sync:unbind',
    listBackups: 'cloud-sync:list-backups',
    createBackup: 'cloud-sync:create-backup',
    removeBackups: 'cloud-sync:remove-backups',
    planRestore: 'cloud-sync:plan-restore',
    readRestoreDiff: 'cloud-sync:read-restore-diff',
    applyRestore: 'cloud-sync:apply-restore',
    cancelRestore: 'cloud-sync:cancel-restore',
    backupProgress: 'cloud-sync:backup-progress'
  },
  app: {
    getPlatform: 'app:get-platform',
    editCommand: 'app:edit-command'
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
    clear: 'todos:clear',
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
    removeCustomProvider: 'models:remove-custom-provider',
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
