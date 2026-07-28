import { reactive } from 'vue';

import type { ChaptaleDesktopApi, TaskReadRunOutputResult, TaskRunCompleteEvent } from '@chaptale/ipc-contract';
import type { ReviewAgentType, ReviewAnchor, ReviewIssue, ReviewIssues, SubagentSlotEvent } from '@chaptale/shared';
import { decodeReviewIssues, resolveReviewAnchor, SUBAGENT_TERMINAL_STATES } from '@chaptale/shared';

import { getDesktopApi, hasDesktopApi, toErrorMessage } from '@/utils/desktop-api';

export type ReviewLaneStatus = 'idle' | 'running' | 'reading' | 'done' | 'failed' | 'cancelled' | 'read-failed';
export type ReviewLaneKey = ReviewAgentType;

type ReviewLaneConfig = {
  readonly key: ReviewLaneKey;
  readonly personaId: 'continuity-reviewer' | 'character-reviewer' | 'style-reviewer';
  readonly agentType: ReviewAgentType;
  readonly brief: string;
};

export const REVIEW_LANE_CONFIGS = [
  {
    key: 'continuity',
    personaId: 'continuity-reviewer',
    agentType: 'continuity',
    brief: '审查以下文本的连贯性问题'
  },
  {
    key: 'character',
    personaId: 'character-reviewer',
    agentType: 'character',
    brief: '审查以下文本的人物一致性问题'
  },
  {
    key: 'style',
    personaId: 'style-reviewer',
    agentType: 'style',
    brief: '审查以下文本的文风与节奏问题'
  }
] as const satisfies readonly ReviewLaneConfig[];

export type ReviewLaneState = ReviewLaneConfig & {
  status: ReviewLaneStatus;
  /** renderer 预生成的取消路由键。 */
  requestId: string | null;
  /** main 侧落盘运行标识。 */
  runId: string | null;
  /** 结构化输出落盘引用；读取结果必须再次校验 runId。 */
  outputRef: string | null;
  /** readRunOutput 解码后的结构化结果；永不使用 tasks.run 的 inline output。 */
  result: ReviewIssues | null;
  errors: string[];
  /** 仅 direct 文本非空时保存，用于派生 anchor；委派与纯附件不伪造。 */
  submittedText?: string;
  /** 每次新操作递增，用于丢弃晚到的 run/read 响应。 */
  operationToken: number;
};

export type ReviewSubagentTaskEvent = Pick<
  SubagentSlotEvent,
  'requestId' | 'personaId' | 'state' | 'runId' | 'outputRef' | 'error'
>;

export type ProjectedReviewIssue = ReviewIssue & {
  anchor?: ReviewAnchor;
};

type TaskApi = ChaptaleDesktopApi['tasks'];

const MAX_TRACKED_REVIEW_TASK_IDS = 128;
const EMPTY_RETAINED_IDS = new Set<string>();

type RecentIdSet = {
  readonly values: Set<string>;
  readonly order: string[];
};

function createRecentIdSet(): RecentIdSet {
  return { values: new Set<string>(), order: [] };
}

function evictOldestUnretainedId(store: RecentIdSet, retainedIds: ReadonlySet<string>) {
  let scansRemaining = store.order.length;
  while (scansRemaining > 0) {
    const candidate = store.order.shift();
    if (!candidate || !store.values.has(candidate)) {
      scansRemaining -= 1;
      continue;
    }

    if (retainedIds.has(candidate)) {
      store.order.push(candidate);
      scansRemaining -= 1;
      continue;
    }

    store.values.delete(candidate);
    return true;
  }

  return false;
}

function pruneRecentIds(store: RecentIdSet, retainedIds: ReadonlySet<string>) {
  while (store.values.size > MAX_TRACKED_REVIEW_TASK_IDS) {
    if (!evictOldestUnretainedId(store, retainedIds)) {
      break;
    }
  }
}

/**
 * requestId/runId 由 renderer/main 生成并按全局唯一处理；容量上限仅用于长会话内存防御。
 * Set 与 FIFO 队列必须同步维护，重复 ID 不重复入队；若全量都被保留，则放弃新增历史 ID。
 */
function rememberRecentId(store: RecentIdSet, id: string, retainedIds: ReadonlySet<string> = EMPTY_RETAINED_IDS) {
  if (store.values.has(id)) {
    return;
  }

  while (store.values.size >= MAX_TRACKED_REVIEW_TASK_IDS) {
    if (!evictOldestUnretainedId(store, retainedIds)) {
      return;
    }
  }

  store.values.add(id);
  store.order.push(id);
  pruneRecentIds(store, retainedIds);
}

function hasRecentId(store: RecentIdSet, id: string) {
  return store.values.has(id);
}

export const reviewLaneTestHelpers = {
  MAX_TRACKED_REVIEW_TASK_IDS,
  createRecentIdSet,
  rememberRecentId
};

function collectCurrentLaneIds(lanes: readonly ReviewLaneState[]) {
  const ids = new Set<string>();
  for (const lane of lanes) {
    if (lane.requestId) {
      ids.add(lane.requestId);
    }
    if (lane.runId) {
      ids.add(lane.runId);
    }
  }
  return ids;
}

function createInitialLane(config: ReviewLaneConfig): ReviewLaneState {
  return {
    ...config,
    status: 'idle',
    requestId: null,
    runId: null,
    outputRef: null,
    result: null,
    errors: [],
    submittedText: undefined,
    operationToken: 0
  };
}

function resetLane(lane: ReviewLaneState) {
  lane.status = 'idle';
  lane.requestId = null;
  lane.runId = null;
  lane.outputRef = null;
  lane.result = null;
  lane.errors = [];
  lane.submittedText = undefined;
  lane.operationToken += 1;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function prepareLaneOperation(lane: ReviewLaneState, requestId: string | null, submittedText: string | undefined) {
  lane.operationToken += 1;
  lane.status = 'running';
  lane.requestId = requestId;
  lane.runId = null;
  lane.outputRef = null;
  lane.result = null;
  lane.errors = [];
  lane.submittedText = submittedText;
  return lane.operationToken;
}

function isCurrentOperation(lane: ReviewLaneState, token: number, runId?: string) {
  return lane.operationToken === token && (runId === undefined || lane.runId === runId);
}

function createRequestId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `review-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function failRead(lane: ReviewLaneState, token: number, runId: string, error: string) {
  if (!isCurrentOperation(lane, token, runId)) {
    return;
  }

  lane.status = 'read-failed';
  lane.errors = [error];
}

function decodeLaneIssues(kind: ReviewAgentType, value: unknown): ReviewIssues | undefined {
  switch (kind) {
    case 'continuity':
      return decodeReviewIssues('continuity', value);
    case 'character':
      return decodeReviewIssues('character', value);
    case 'style':
      return decodeReviewIssues('style', value);
  }
}

async function readLaneOutput(lane: ReviewLaneState, tasks: TaskApi, token: number, runId: string, outputRef: string) {
  if (!isCurrentOperation(lane, token, runId)) {
    return;
  }

  lane.status = 'reading';

  let envelope: TaskReadRunOutputResult | null;
  try {
    envelope = await tasks.readRunOutput(outputRef);
  } catch (error) {
    failRead(lane, token, runId, toErrorMessage(error));
    return;
  }

  if (!isCurrentOperation(lane, token, runId)) {
    return;
  }

  if (envelope?.kind !== 'review') {
    failRead(lane, token, runId, '审查结果读取失败：输出不是 review 信封');
    return;
  }

  if (envelope.runId !== runId) {
    failRead(lane, token, runId, '审查结果读取失败：runId 不匹配');
    return;
  }

  const decoded = decodeLaneIssues(lane.agentType, envelope.output);
  if (!decoded) {
    failRead(lane, token, runId, '审查结果读取失败：输出结构不符合 schema');
    return;
  }

  lane.result = decoded;
  lane.errors = [];
  lane.status = 'done';
}

function applyRunFailure(
  lane: ReviewLaneState,
  token: number,
  result: Extract<TaskRunCompleteEvent, { status: 'failed' }>
) {
  if (!isCurrentOperation(lane, token, result.runId)) {
    return;
  }

  lane.outputRef = result.outputRef;
  lane.errors = result.errors;
  lane.status = 'failed';
}

async function startLane(
  lane: ReviewLaneState,
  tasks: TaskApi,
  text: string,
  contextFilePaths: readonly string[],
  submittedText: string | undefined
) {
  const requestId = createRequestId();
  const token = prepareLaneOperation(lane, requestId, submittedText);

  let result: TaskRunCompleteEvent;
  try {
    result = await tasks.run({
      requestId,
      personaId: lane.personaId,
      brief: lane.brief,
      text,
      ...(contextFilePaths.length > 0 ? { contextFilePaths: [...contextFilePaths] } : {})
    });
  } catch (error) {
    if (isCurrentOperation(lane, token)) {
      lane.errors = [toErrorMessage(error)];
      lane.status = 'failed';
    }
    return;
  }

  if (!isCurrentOperation(lane, token)) {
    return;
  }

  lane.runId = result.runId;

  if (result.status === 'cancelled') {
    lane.status = 'cancelled';
    return;
  }

  if (result.status === 'failed') {
    applyRunFailure(lane, token, result);
    return;
  }

  lane.outputRef = result.outputRef;
  await readLaneOutput(lane, tasks, token, result.runId, result.outputRef);
}

function findLane(lanes: ReviewLaneState[], laneKey: ReviewLaneKey) {
  return lanes.find(lane => lane.key === laneKey);
}

function findLaneByPersona(lanes: ReviewLaneState[], personaId: string) {
  return lanes.find(lane => lane.personaId === personaId);
}

function normalizeEvents(events: ReviewSubagentTaskEvent | readonly ReviewSubagentTaskEvent[]) {
  return Array.isArray(events) ? events : [events];
}

function applyAttachedTerminal(lane: ReviewLaneState, event: ReviewSubagentTaskEvent) {
  lane.operationToken += 1;
  lane.requestId = event.requestId;
  lane.runId = event.runId ?? null;
  lane.outputRef = event.outputRef ?? null;
  lane.result = null;
  lane.submittedText = undefined;
  lane.errors = event.error ? [event.error] : [];
  return lane.operationToken;
}

function shouldSkipLaneTakeover(lane: ReviewLaneState, event: ReviewSubagentTaskEvent) {
  if (lane.status === 'idle') {
    return false;
  }

  return event.requestId !== lane.requestId && event.runId !== lane.runId;
}

/** 将 lane 中的结构化 issue 投影成 UI 可直接使用的数据；无 direct 文本时不生成 anchor。 */
export function projectReviewLaneIssues(lane: ReviewLaneState): ProjectedReviewIssue[] {
  const issues = lane.result?.issues ?? [];
  const submittedText = lane.submittedText?.trim();

  if (!submittedText) {
    return issues.map(issue => Object.assign({}, issue));
  }

  return issues.map(issue =>
    Object.assign({}, issue, {
      anchor: resolveReviewAnchor(submittedText, issue)
    })
  );
}

export function useReviewLanes(getText: () => string, getContextFilePaths: () => string[]) {
  const lanes = reactive(REVIEW_LANE_CONFIGS.map(config => createInitialLane(config)));
  const seenAttachedRunIds = createRecentIdSet();
  const ignoredRequestIds = createRecentIdSet();
  const ignoredRunIds = createRecentIdSet();

  function rememberIgnoredLane(lane: ReviewLaneState) {
    const retainedIds = collectCurrentLaneIds(lanes);
    if (lane.requestId) {
      rememberRecentId(ignoredRequestIds, lane.requestId, retainedIds);
    }
    if (lane.runId) {
      rememberRecentId(ignoredRunIds, lane.runId, retainedIds);
    }
  }

  async function startAll() {
    if (!hasDesktopApi()) {
      return;
    }

    const text = getText().trim();
    const contextFilePaths = getContextFilePaths();
    if (!text && contextFilePaths.length === 0) {
      return;
    }

    const submittedText = text ? text : undefined;
    const tasks = getDesktopApi().tasks;
    await Promise.all(lanes.map(lane => startLane(lane, tasks, text, contextFilePaths, submittedText)));
  }

  async function retryRead(laneKey: ReviewLaneKey) {
    if (!hasDesktopApi()) {
      return;
    }

    const lane = findLane(lanes, laneKey);
    if (!lane?.runId || !lane.outputRef) {
      return;
    }

    lane.operationToken += 1;
    lane.errors = [];
    const token = lane.operationToken;
    await readLaneOutput(lane, getDesktopApi().tasks, token, lane.runId, lane.outputRef);
  }

  async function cancel(laneKey: ReviewLaneKey) {
    if (!hasDesktopApi()) {
      return;
    }

    const lane = findLane(lanes, laneKey);
    if (!lane?.requestId) {
      return;
    }

    const requestId = lane.requestId;
    lane.operationToken += 1;
    const token = lane.operationToken;
    const retainedIds = collectCurrentLaneIds(lanes);
    rememberRecentId(ignoredRequestIds, requestId, retainedIds);
    if (lane.runId) {
      rememberRecentId(ignoredRunIds, lane.runId, retainedIds);
    }
    lane.status = 'cancelled';
    lane.result = null;
    lane.errors = [];

    try {
      await getDesktopApi().tasks.cancel(requestId);
    } catch (error) {
      if (lane.operationToken === token) {
        lane.status = 'failed';
        lane.errors = [toErrorMessage(error)];
      }
    }
  }

  function dismiss(laneKey: ReviewLaneKey) {
    if (!hasDesktopApi()) {
      return;
    }

    const lane = findLane(lanes, laneKey);
    if (lane) {
      rememberIgnoredLane(lane);
      resetLane(lane);
    }
  }

  async function attachSubagentTasks(events: ReviewSubagentTaskEvent | readonly ReviewSubagentTaskEvent[]) {
    if (!hasDesktopApi()) {
      return;
    }

    const tasks = getDesktopApi().tasks;
    const reads: Promise<void>[] = [];

    for (const event of normalizeEvents(events)) {
      const lane = findLaneByPersona(lanes, event.personaId);
      if (!lane) {
        continue;
      }

      if (!SUBAGENT_TERMINAL_STATES.includes(event.state)) {
        continue;
      }

      if (!isNonEmptyString(event.runId)) {
        continue;
      }

      if (event.state === 'success' && !isNonEmptyString(event.outputRef)) {
        continue;
      }

      if (hasRecentId(ignoredRequestIds, event.requestId) || hasRecentId(ignoredRunIds, event.runId)) {
        continue;
      }

      if (hasRecentId(seenAttachedRunIds, event.runId)) {
        continue;
      }

      if (shouldSkipLaneTakeover(lane, event)) {
        continue;
      }

      rememberRecentId(seenAttachedRunIds, event.runId, collectCurrentLaneIds(lanes));

      if (event.state === 'success') {
        const token = applyAttachedTerminal(lane, event);
        lane.status = 'reading';
        reads.push(readLaneOutput(lane, tasks, token, event.runId, event.outputRef));
        continue;
      }

      const token = applyAttachedTerminal(lane, event);
      if (!isCurrentOperation(lane, token)) {
        continue;
      }

      if (event.state === 'cancelled') {
        lane.status = 'cancelled';
      } else {
        lane.status = 'failed';
        lane.errors = event.error ? [event.error] : [`子任务${event.state === 'timeout' ? '超时' : '失败'}`];
      }
    }

    await Promise.all(reads);
  }

  return {
    lanes,
    startAll,
    retryRead,
    cancel,
    dismiss,
    attachSubagentTasks
  };
}
