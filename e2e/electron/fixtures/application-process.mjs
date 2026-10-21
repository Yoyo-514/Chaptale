import { app } from 'electron';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const [root, script, report] = process.argv.slice(2);
const options = {
  script,
  creationDir: path.join(root, 'creation'),
  agent: {
    cwd: path.join(root, 'work'),
    configDir: path.join(root, 'config'),
    agentDir: path.join(root, 'agent'),
    sessionDir: path.join(root, 'sessions'),
    settingsFile: path.join(root, 'settings.json')
  }
};
const value = result => {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
};

app.whenReady().then(async () => {
  try {
    const { DesktopApplicationProcess } = await import('../../../apps/desktop/src/main/application-host/process.ts');
    let host = new DesktopApplicationProcess(options);
    const events = [];
    host.creation.subscribe(event => events.push(event));
    const work = value(
      await host.creation.request('createWork', { commandId: 'work', title: '长夜行', kind: 'novel' })
    );
    const document = value(
      await host.creation.request('createEntry', {
        commandId: 'document',
        workId: work.id,
        parentId: null,
        section: 'manuscript',
        kind: 'document',
        title: '序章',
        format: 'txt',
        content: '原文'
      })
    );
    const save = {
      commandId: 'save',
      workId: work.id,
      documentId: document.id,
      expectedRevisionId: document.revisionId,
      title: '雨夜',
      format: 'txt',
      content: '第一行\r\n第二行'
    };
    const saved = value(await host.creation.request('saveDocument', save));
    const conflict = await host.creation.request('saveDocument', { ...save, commandId: 'stale' });
    const agent = await host.agent.request('state', undefined);
    const processCount = app.getAppMetrics().filter(item => item.name === 'Chaptale Application').length;
    await host.dispose();
    host = new DesktopApplicationProcess(options);
    const reopened = value(await host.creation.request('readDocument', { workId: work.id, documentId: document.id }));
    const snapshot = value(await host.creation.request('snapshot', { workId: work.id }));
    const disconnected = new Promise(resolve => host.onExit(resolve));
    const child = app.getAppMetrics().find(item => item.name === 'Chaptale Application');
    process.kill(child.pid);
    const exitMessage = await disconnected;
    const afterCrash = value(await host.creation.request('snapshot', { workId: work.id }));
    await host.dispose();
    await writeFile(
      report,
      JSON.stringify({
        processCount,
        agentSessions: agent.sessions,
        events,
        saved,
        reopened,
        conflict,
        snapshot,
        afterCrash,
        exitMessage
      })
    );
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
