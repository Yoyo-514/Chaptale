/**
 * Renderer 与主进程共享的频道唯一来源。
 * 按业务域分组可让 Preload、handler 注册和契约审查使用同一组不可变字面量。
 */
export const IPC_CHANNELS = {
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
    selectWorkspaceDir: 'settings:select-workspace-dir',
    openConfigDir: 'settings:open-config-dir'
  }
} as const;
