import type { HostEvent, HostState } from '@chaptale/agent-host/protocol';

/** 把宿主事件按游标合并进界面快照；旧游标的事件丢弃。 */
export function applyHostEvent(snapshot: HostState, event: HostEvent) {
  if (event.cursor <= snapshot.cursor) return;
  snapshot.cursor = event.cursor;
  const session = (id: string) => snapshot.sessions.find(item => item.id === id)!;
  switch (event.kind) {
    case 'session': {
      const index = snapshot.sessions.findIndex(item => item.id === event.session.id);
      if (index === -1) snapshot.sessions.push(event.session);
      else snapshot.sessions[index] = event.session;
      break;
    }
    case 'message':
      session(event.id).messages[event.index] = event.message;
      break;
    case 'delta':
      session(event.id).messages[event.index][event.field] += event.text;
      break;
    case 'running': {
      const target = session(event.id);
      target.running = event.running;
      target.compacting = event.compacting;
      target.error = event.error;
      break;
    }
    case 'usage':
      session(event.id).usage = event.usage;
      break;
    case 'closed':
      snapshot.sessions = snapshot.sessions.filter(item => item.id !== event.id);
      break;
    case 'approval':
      snapshot.approvals.push(event.approval);
      break;
    case 'approval-closed':
      snapshot.approvals = snapshot.approvals.filter(approval => approval.id !== event.id);
      break;
    case 'models':
      snapshot.models = event.models;
      break;
    case 'settings':
      snapshot.settings = event.settings;
      break;
  }
}
