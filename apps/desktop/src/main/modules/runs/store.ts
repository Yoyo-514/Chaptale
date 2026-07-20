import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { AgentRunRecord } from './record';

export type AgentRunStoreOptions = {
  /** 解析当前 workspace 根目录（作品文件夹）；每次落盘/读取时求值，跟随工作区切换。 */
  resolveCwd: () => Promise<string> | string;
};

export type AgentRunListOptions = {
  /** 返回条数上限（倒序取最近 N 条）。 */
  limit?: number;
  /** 按 persona 过滤。 */
  personaId?: string;
};

/** 单行解析失败的诊断信息：跳过坏行但保留线索，不让一条脏数据拖垮整个列表。 */
export type AgentRunDiagnostic = {
  filePath: string;
  line: number;
  message: string;
};

export type AgentRunListResult = {
  records: AgentRunRecord[];
  diagnostics: AgentRunDiagnostic[];
};

/**
 * AgentRun 记录的 JSONL 落盘存储。
 *
 * - 记录按 createdAt 归入月份文件 `.chaptale/runs/agent-runs-YYYY-MM.jsonl`，
 *   追加写不改历史，天然适合审计与网盘同步；
 * - 大输出体落 `runs/outputs/<runId>.json` 独立文件，记录里只留相对路径引用；
 * - 读取只扫当月 + 上月两份文件——近期复盘是主场景，更久远的记录留给未来的索引层。
 * 零 pi 依赖，纯 Node 实现。
 */
export class AgentRunStore {
  constructor(private readonly options: AgentRunStoreOptions) {}

  /** 追加一条终态记录；目录不存在则惰性创建。 */
  async append(record: AgentRunRecord): Promise<void> {
    const filePath = this.resolveMonthFile(await this.options.resolveCwd(), record.createdAt);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.appendFile(filePath, `${JSON.stringify(record)}\n`, 'utf8');
  }

  /** 落盘输出体，返回相对 workspace 的引用路径（存进记录的 outputRef）。 */
  async saveOutput(runId: string, rawText: string): Promise<string> {
    const relativePath = path.join('.chaptale', 'runs', 'outputs', `${runId}.json`);
    const filePath = path.join(await this.options.resolveCwd(), relativePath);

    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, `${JSON.stringify({ runId, rawText }, null, 2)}\n`, 'utf8');

    // 统一用正斜杠，保证引用路径跨平台一致（Windows 本机与网盘同步端一致）。
    return relativePath.split(path.sep).join('/');
  }

  /** 倒序列出最近的记录（当月 + 上月），坏行跳过并计入 diagnostics。 */
  async list(options: AgentRunListOptions = {}): Promise<AgentRunListResult> {
    const cwd = await this.options.resolveCwd();
    const now = new Date();
    const previousMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));

    // 先上月后当月，保持行序即时间序（同文件内追加写天然有序）。
    const filePaths = [
      this.resolveMonthFile(cwd, previousMonth.toISOString()),
      this.resolveMonthFile(cwd, now.toISOString())
    ];

    const records: AgentRunRecord[] = [];
    const diagnostics: AgentRunDiagnostic[] = [];

    for (const filePath of filePaths) {
      const content = await readOptionalFile(filePath);

      if (content === undefined) {
        continue;
      }

      const lines = content.split('\n');

      for (const [index, line] of lines.entries()) {
        if (!line.trim()) {
          continue;
        }

        const record = parseRecordLine(line);

        if (record === undefined) {
          diagnostics.push({
            filePath,
            line: index + 1,
            message: 'JSONL 行解析失败或缺少必要字段，已跳过'
          });
          continue;
        }

        records.push(record);
      }
    }

    let filtered = records;

    if (options.personaId !== undefined) {
      filtered = filtered.filter(record => record.personaId === options.personaId);
    }

    // 倒序：最近的记录排最前。
    filtered = filtered.toReversed();

    if (options.limit !== undefined) {
      filtered = filtered.slice(0, options.limit);
    }

    return { records: filtered, diagnostics };
  }

  /** 由 ISO 时间串定位月份文件路径（UTC 月份，与 toISOString 一致）。 */
  private resolveMonthFile(cwd: string, createdAt: string): string {
    // ISO 8601 前 7 位即 YYYY-MM，避免时区换算引入歧义。
    const yearMonth = createdAt.slice(0, 7);
    return path.join(cwd, '.chaptale', 'runs', `agent-runs-${yearMonth}.jsonl`);
  }
}

/** 读取可能不存在的文件；文件缺失是常态（当月还没有记录），静默降级。 */
async function readOptionalFile(filePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return undefined;
  }
}

/** 解析单行 JSONL；语法错误或形状不对都返回 undefined，由调用方计入 diagnostics。 */
function parseRecordLine(line: string): AgentRunRecord | undefined {
  let parsed: unknown;

  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }

  if (!isRecordShape(parsed)) {
    return undefined;
  }

  return parsed;
}

/** 最小形状校验：只查关键字段类型，容忍未来新增的可选字段。 */
function isRecordShape(value: unknown): value is AgentRunRecord {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;

  return (
    typeof record.id === 'string' &&
    typeof record.personaId === 'string' &&
    typeof record.status === 'string' &&
    typeof record.createdAt === 'string'
  );
}
