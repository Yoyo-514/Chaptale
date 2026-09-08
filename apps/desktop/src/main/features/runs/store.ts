import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';

import { AgentRunRecordValidator } from '@chaptale/shared';

import { createArtifact, resolveArtifactPath } from '../../core/workspace/artifacts';
import { prepareSafeOutputFile, resolveExistingDirectJsonFile } from '../../infra/filesystem/safe-output-file';
import { withFileWriteLock } from '../../infra/filesystem/write-lock';
import { readDocumentSnapshot } from '../workspace/read-document';
import type { AgentRunRecord } from './record';

const RAW_OUTPUT_DIRECTORY = ['.chaptale', 'runs', 'outputs'];

export type AgentRunStoreOptions = {
  /** 解析当前 workspace 根目录（作品文件夹）；每次落盘/读取时求值，跟随工作区切换。 */
  resolveCwd: () => Promise<string> | string;
};

export type AgentRunListOptions = {
  /** 返回条数上限（倒序取最近 N 条）。 */
  limit?: number;
  /** 按 persona 过滤。 */
  personaId?: string;
  status?: AgentRunRecord['status'];
  query?: string;
  runId?: string;
  before?: string;
  rootPath?: string;
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
  nextCursor?: string;
};

/**
 * AgentRun 记录的 JSONL 落盘存储。
 *
 * - 记录按 createdAt 归入月份文件 `.chaptale/runs/agent-runs-YYYY-MM.jsonl`，
 *   追加写不改历史，天然适合审计与网盘同步；
 * - 大输出体落 `runs/outputs/<runId>.json` 独立文件，记录里只留相对路径引用；
 * - 跨月份流式读取，按创建时间与文件行序倒序；分页游标绑定具体记录，不随新记录偏移。
 * 纯 Node 实现。
 */
export class AgentRunStore {
  constructor(private readonly options: AgentRunStoreOptions) {}

  /** 追加一条终态记录；cwdOverride 用于把一次运行固定在启动时的工作区。 */
  async append(record: AgentRunRecord, cwdOverride?: string): Promise<void> {
    const cwd = cwdOverride ?? (await this.options.resolveCwd());
    if (!AgentRunRecordValidator.Check(record)) throw new Error('运行记录字段无效');
    const relativePath = this.resolveMonthFile(record.createdAt);
    const filePath = await resolveArtifactPath(cwd, relativePath);
    let outputHash: string | undefined;
    if (record.outputRef) {
      if (
        ![`.chaptale/reviews/${record.id}.json`, `.chaptale/runs/outputs/${record.id}.json`].includes(record.outputRef)
      )
        throw new Error('运行输出引用与记录不匹配');
      await resolveArtifactPath(cwd, record.outputRef);
      outputHash = (
        await readDocumentSnapshot({ rootPath: cwd, relativePath: record.outputRef, maxBytes: 32 * 1024 * 1024 })
      ).contentHash;
      if (record.outputHash && outputHash !== record.outputHash) throw new Error('运行输出已变化');
    }
    const line = JSON.stringify({ ...record, ...(outputHash ? { outputHash } : {}) });
    if (Buffer.byteLength(line) > 1024 * 1024) throw new Error('运行记录超过 1 MiB');
    await withFileWriteLock(filePath, async () => {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await resolveArtifactPath(cwd, relativePath);
      const handle = await fs.open(filePath, 'a+');
      try {
        const stat = await handle.stat();
        let separator = '';
        if (stat.size) {
          const last = Buffer.alloc(1);
          await handle.read(last, 0, 1, stat.size - 1);
          if (last[0] !== 10) separator = '\n';
        }
        await handle.writeFile(`${separator}${line}\n`, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
    });
  }

  /** 落盘输出体；cwdOverride 与 append 共用，避免工作区切换把同一 run 拆开。 */
  async saveOutput(runId: string, rawText: string, cwdOverride?: string): Promise<string> {
    const cwd = cwdOverride ?? (await this.options.resolveCwd());
    const target = await prepareSafeOutputFile(cwd, RAW_OUTPUT_DIRECTORY, runId);

    await createArtifact(cwd, target.outputRef, JSON.stringify({ runId, rawText }));

    // 统一用正斜杠，保证引用路径跨平台一致（Windows 本机与网盘同步端一致）。
    return target.outputRef;
  }

  /** 安全删除 raw output；非法 ref 与文件缺失都按幂等成功处理。 */
  async removeOutput(outputRef: string, cwdOverride?: string): Promise<void> {
    const filePath = await this.resolveOutputFile(outputRef, cwdOverride);

    if (!filePath) {
      return;
    }

    await fs.rm(filePath, { force: true });
  }

  /**
   * 按 outputRef 读回输出体原文；引用非法或文件不存在时返回 null。
   *
   * outputRef 来自事件/记录透传，但仍按不可信输入处理：解析后必须
   * 落在 outputs 目录内，阻断路径穿越读任意文件。
   */
  async readOutput(outputRef: string): Promise<{ runId: string; rawText: string; contentHash: string } | null> {
    const cwd = await this.options.resolveCwd();
    const filePath = await this.resolveOutputFile(outputRef, cwd);

    if (!filePath) {
      return null;
    }

    try {
      const snapshot = await readDocumentSnapshot({
        rootPath: cwd,
        relativePath: outputRef,
        maxBytes: 32 * 1024 * 1024
      });
      const parsed: unknown = JSON.parse(snapshot.content);

      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        (parsed as { runId?: unknown }).runId === path.basename(filePath, '.json') &&
        typeof (parsed as { rawText?: unknown }).rawText === 'string'
      ) {
        return {
          runId: (parsed as { runId: string }).runId,
          rawText: (parsed as { rawText: string }).rawText,
          contentHash: snapshot.contentHash
        };
      }

      return null;
    } catch {
      return null;
    }
  }

  /** 读取全部月份，坏行和不可读文件保留诊断，不能伪装为没有历史。 */
  async list(options: AgentRunListOptions = {}): Promise<AgentRunListResult> {
    const cwd = await this.options.resolveCwd();
    if (options.rootPath && path.resolve(options.rootPath) !== path.resolve(cwd)) throw new Error('工作区已切换');
    const limit = options.limit ?? 100;
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error('运行记录分页大小无效');
    const records: AgentRunRecord[] = [];
    const diagnostics: AgentRunDiagnostic[] = [];
    let names: string[];
    try {
      names = await fs.readdir(await resolveArtifactPath(cwd, '.chaptale/runs'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { records, diagnostics };
      throw error;
    }
    const ids = new Set<string>();
    for (const name of names.filter(value => /^agent-runs-\d{4}-(0[1-9]|1[0-2])\.jsonl$/.test(value)).toSorted()) {
      const relativePath = `.chaptale/runs/${name}`;
      const filePath = path.join(cwd, relativePath);
      let lineNumber = 0;
      try {
        await resolveArtifactPath(cwd, relativePath);
        if ((await fs.stat(filePath)).size > 64 * 1024 * 1024) throw new Error('月份记录超过 64 MiB，未加载此文件');
        const stream = createReadStream(filePath, { encoding: 'utf8' });
        const lines = createInterface({ input: stream, crlfDelay: Infinity });
        try {
          for await (const line of lines) {
            lineNumber++;
            if (!line.trim()) continue;
            const record = Buffer.byteLength(line) <= 1024 * 1024 ? parseRecordLine(line) : undefined;
            if (!record || ids.has(record.id)) {
              diagnostics.push({
                filePath,
                line: lineNumber,
                message: record ? '重复的运行 id，已跳过' : 'JSONL 行解析失败或缺少必要字段，已跳过'
              });
              continue;
            }
            ids.add(record.id);
            records.push(record);
          }
        } finally {
          lines.close();
          stream.destroy();
        }
      } catch (error) {
        diagnostics.push({ filePath, line: lineNumber, message: String(error) });
      }
    }
    const query = options.query?.trim().toLocaleLowerCase() ?? '';
    const filtered = records
      .toReversed()
      .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))
      .filter(
        record =>
          (!options.personaId || record.personaId === options.personaId) &&
          (!options.status || record.status === options.status) &&
          (!options.runId || record.id === options.runId) &&
          (!query ||
            [
              record.id,
              record.personaId,
              record.model?.modelId,
              record.inputDigest.brief,
              ...(record.inputDigest.files ?? [])
            ]
              .join('\n')
              .toLocaleLowerCase()
              .includes(query))
      );
    const start = options.before ? filtered.findIndex(record => record.id === options.before) + 1 : 0;
    if (options.before && start === 0) throw new Error('分页依据已变化，请刷新运行记录');
    const page = filtered.slice(start, start + limit);
    return { records: page, diagnostics, ...(start + limit < filtered.length ? { nextCursor: page.at(-1)!.id } : {}) };
  }

  private async resolveOutputFile(outputRef: string, cwdOverride?: string): Promise<string | null> {
    const cwd = cwdOverride ?? (await this.options.resolveCwd());
    const resolved = await resolveExistingDirectJsonFile(cwd, outputRef, RAW_OUTPUT_DIRECTORY);

    return resolved?.filePath ?? null;
  }

  /** 由 ISO 时间串定位月份文件路径（UTC 月份，与 toISOString 一致）。 */
  private resolveMonthFile(createdAt: string): string {
    if (!/^\d{4}-(0[1-9]|1[0-2])-\d{2}T/.test(createdAt) || !Number.isFinite(Date.parse(createdAt)))
      throw new Error('运行时间无效');
    const yearMonth = createdAt.slice(0, 7);
    return `.chaptale/runs/agent-runs-${yearMonth}.jsonl`;
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

  if (!AgentRunRecordValidator.Check(parsed) || !Number.isFinite(Date.parse(parsed.createdAt))) {
    return undefined;
  }

  return parsed;
}
