import {
  ContentBundleTextValidator,
  ContentContextValidator,
  ContentExportValidator,
  ContentImportValidator,
  ContentPreviewValidator,
  ContentReadValidator,
  ContentSaveValidator,
  IPC_CHANNELS,
  type ContentContext,
  type ContentExportArgs,
  type ContentImportArgs,
  type ContentPreviewArgs,
  type ContentReadArgs,
  type ContentSaveArgs
} from '@chaptale/ipc-contract';

import type { UiShell } from '../../core/ipc-ports';
import { writeTextAtomically } from '../../infra/filesystem/atomic-text';
import { handleValidatedIpc } from '../../infra/security/validated-ipc';
import { ContentBundles, parseContentBundle } from './bundles';
import { portableContent } from './codec';
import type { ContentService } from './service';

export function registerContentIpc(service: ContentService, ui: UiShell) {
  const bundles = new ContentBundles(service);
  handleValidatedIpc(IPC_CHANNELS.content.list, ContentContextValidator, (_event, args: ContentContext) =>
    service.list(args)
  );
  handleValidatedIpc(IPC_CHANNELS.content.read, ContentReadValidator, (_event, args: ContentReadArgs) =>
    service.read(args)
  );
  handleValidatedIpc(IPC_CHANNELS.content.save, ContentSaveValidator, (_event, args: ContentSaveArgs) =>
    service.save(args)
  );
  handleValidatedIpc(IPC_CHANNELS.content.archive, ContentReadValidator, (_event, args: ContentReadArgs) =>
    service.archive(args)
  );
  handleValidatedIpc(IPC_CHANNELS.content.previewExport, ContentExportValidator, (_event, args: ContentExportArgs) =>
    bundles.previewExport(args)
  );
  handleValidatedIpc(IPC_CHANNELS.content.previewImport, ContentPreviewValidator, (_event, args: ContentPreviewArgs) =>
    bundles.previewImport(args)
  );
  handleValidatedIpc(IPC_CHANNELS.content.import, ContentImportValidator, (_event, args: ContentImportArgs) =>
    bundles.import(args)
  );
  handleValidatedIpc(
    IPC_CHANNELS.content.saveExport,
    ContentBundleTextValidator,
    async (_event, args: { text: string }) => {
      const bundle = parseContentBundle(args.text);
      if (bundle.entries.some(item => portableContent(item.kind, item.markdown).markdown !== item.markdown))
        throw new Error('导出内容尚未移除本机权限，请重新预览');
      const target = await ui.pickSavePath({
        title: '导出创作内容包',
        defaultPath: 'chaptale-content.json',
        filters: [{ name: 'Chaptale 内容包', extensions: ['json'] }]
      });
      if (!target) return null;
      await writeTextAtomically(target, args.text);
      return target;
    }
  );
}
