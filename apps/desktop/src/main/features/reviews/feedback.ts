import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import {
  REVIEW_ISSUE_LABELS,
  type ReviewFeedbackList,
  type ReviewFeedbackSuggestion,
  type ReviewPreference
} from '@chaptale/shared';
import { parseDocumentFrontmatter, patchDocumentFields } from '@chaptale/shared/document-frontmatter';

import { resolveArtifactPath } from '../../core/workspace/artifacts';
import { createTextAtomically, writeTextAtomically } from '../../infra/filesystem/atomic-text';
import { resolveWithinCwd } from '../../infra/filesystem/path-guard';
import { withFileWriteLock } from '../../infra/filesystem/write-lock';
import type { ReviewWorkflowStore } from './workflow-store';

const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const decisionPath = '.chaptale/reviews/feedback.json';
const key = (personaId: string, issueType: string) => `${personaId}:${issueType}`;
const validPersona = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length <= 64;
const validIssueType = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.trim().length > 0 &&
  value.length <= 80 &&
  value.isWellFormed() &&
  [...value].every(character => character.charCodeAt(0) >= 32);
type FeedbackDecisions = Record<string, { suggestionId: string; dismissedAt: string }>;

export class ReviewFeedbackStore {
  constructor(
    private readonly reviews: ReviewWorkflowStore,
    private readonly authorRoot: string
  ) {}

  private async preferencePath(filename = '') {
    const relative = `memory/preferences${filename ? `/${filename}` : ''}`;
    const parts = relative.split('/');
    for (let count = 1; count <= parts.length; count++) {
      const target = await resolveWithinCwd(this.authorRoot, parts.slice(0, count).join('/'));
      try {
        if ((await lstat(target)).isSymbolicLink()) throw new Error('偏好目录不能包含链接');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    return resolveWithinCwd(this.authorRoot, relative);
  }
  async preferences(): Promise<{ preferences: ReviewPreference[]; diagnostics: string[] }> {
    const preferences: ReviewPreference[] = [];
    const diagnostics: string[] = [];
    let names: string[];
    try {
      names = (await readdir(await this.preferencePath()))
        .filter(name => /^review-[a-f0-9]{64}\.md$/.test(name))
        .toSorted();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') diagnostics.push(String(error));
      return { preferences, diagnostics };
    }
    if (names.length > 200) diagnostics.push('审查偏好超过 200 项，仅载入前 200 项');
    for (const name of names.slice(0, 200)) {
      try {
        const filename = await this.preferencePath(name);
        if ((await lstat(filename)).size > 64 * 1024) throw new Error('偏好文件过大');
        const content = await readFile(filename, 'utf8');
        const head = parseDocumentFrontmatter(content);
        if (
          head.status !== 'ok' ||
          head.frontmatter.kind !== 'preference' ||
          !validPersona(head.frontmatter.personaId) ||
          !validIssueType(head.frontmatter.issueType) ||
          typeof head.frontmatter.confirmedAt !== 'string' ||
          !head.body.trim()
        )
          throw new Error('偏好元数据无效');
        preferences.push({
          id: name.slice(7, -3),
          personaId: head.frontmatter.personaId as ReviewPreference['personaId'],
          issueType: head.frontmatter.issueType,
          text: head.body.trim(),
          sourceRef: `author:memory/preferences/${name}`,
          contentHash: hash(content)
        });
      } catch (error) {
        diagnostics.push(`${name}: ${String(error)}`);
      }
    }
    return { preferences, diagnostics };
  }
  async forPersona(personaId: string) {
    if (!validPersona(personaId)) return { prompt: '', memoryRefs: [] };
    const { preferences, diagnostics } = await this.preferences();
    if (diagnostics.length) throw new Error(`审查偏好读取失败：${diagnostics.join('\n')}`);
    const selected = preferences.filter(item => item.personaId === personaId);
    const escaped = selected.map(item =>
      item.text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    );
    return {
      prompt: selected.length
        ? `<author_confirmed_review_preferences>\n${escaped.join('\n\n')}\n</author_confirmed_review_preferences>`
        : '',
      memoryRefs: selected.map(item => `${item.sourceRef}#${item.contentHash}`)
    };
  }
  private async decisions(rootPath: string): Promise<FeedbackDecisions> {
    try {
      const filename = await resolveArtifactPath(rootPath, decisionPath);
      if ((await lstat(filename)).size > 64 * 1024) throw new Error('偏好确认记录过大');
      const value: unknown = JSON.parse(await readFile(filename, 'utf8'));
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('偏好确认记录损坏');
      const entries = Object.entries(value);
      if (
        entries.some(
          ([name, item]) =>
            !validPersona(name.slice(0, name.indexOf(':'))) ||
            !validIssueType(name.slice(name.indexOf(':') + 1)) ||
            !item ||
            typeof item !== 'object' ||
            Array.isArray(item) ||
            !('suggestionId' in item) ||
            typeof item.suggestionId !== 'string' ||
            !/^[a-f0-9]{64}$/.test(item.suggestionId) ||
            !('dismissedAt' in item) ||
            typeof item.dismissedAt !== 'string'
        )
      )
        throw new Error('偏好确认记录损坏');
      return value as FeedbackDecisions;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw error;
    }
  }
  async list(rootPath: string): Promise<ReviewFeedbackList> {
    const { preferences, diagnostics } = await this.preferences();
    const decisions = await this.decisions(rootPath);
    const listed = await this.reviews.list(rootPath);
    diagnostics.push(...listed.diagnostics);
    const actions: Array<{
      jobId: string;
      personaId: ReviewPreference['personaId'];
      issueType: string;
      index: number;
      status: string;
      at: string;
      outputHash: string;
    }> = [];
    for (const job of listed.jobs.filter(item => item.status === 'done')) {
      try {
        const detail = await this.reviews.read(rootPath, job.id);
        if (!detail.state || !detail.result) continue;
        for (const [index, decision] of Object.entries(detail.state.issues)) {
          const issue = detail.result.issues[Number(index)];
          if (issue)
            actions.push({
              jobId: job.id,
              personaId: job.personaId,
              issueType: issue.type,
              index: Number(index),
              status: decision.status,
              at: decision.updatedAt,
              outputHash: detail.state.outputHash
            });
        }
      } catch (error) {
        diagnostics.push(`${job.id}: ${String(error)}`);
      }
    }
    const streaks = new Map<string, typeof actions>();
    // 同毫秒的跨任务操作无法恢复先后次序，非忽略排在末尾，避免误报连续忽略。
    for (const action of actions.toSorted(
      (a, b) =>
        a.at.localeCompare(b.at) ||
        Number(a.status !== 'ignored') - Number(b.status !== 'ignored') ||
        a.jobId.localeCompare(b.jobId) ||
        a.index - b.index
    )) {
      const name = key(action.personaId, action.issueType);
      if (action.status !== 'ignored') streaks.set(name, []);
      else {
        const streak = streaks.get(name) ?? [];
        streak.push(action);
        streaks.set(name, streak);
      }
    }
    const suggestions: ReviewFeedbackSuggestion[] = [];
    if (diagnostics.length) return { suggestions, preferences, diagnostics };
    for (const [name, streak] of streaks) {
      if (streak.length < 5 || decisions[name]) continue;
      const { personaId, issueType } = streak[0];
      if (preferences.some(item => item.personaId === personaId && item.issueType === issueType)) continue;
      const label = REVIEW_ISSUE_LABELS[issueType] ?? issueType;
      suggestions.push({
        id: hash(JSON.stringify(streak)),
        personaId,
        issueType,
        ignoredCount: streak.length,
        reviewIds: [...new Set(streak.map(item => item.jobId))],
        text: `降低“${label}”检查的优先级，只在有明确原文证据且影响叙事时提出；仍保留严重矛盾和事实错误。`
      });
    }
    return { suggestions, preferences, diagnostics };
  }
  async resolve(rootPath: string, id: string, action: 'accept' | 'dismiss', text?: string) {
    const filename = await resolveArtifactPath(rootPath, decisionPath);
    await withFileWriteLock(filename, async () => {
      const current = await this.list(rootPath);
      const accepted = current.preferences.find(item => item.id === id);
      if (action === 'accept' && accepted && accepted.text === text?.trim()) return;
      const suggestion = current.suggestions.find(item => item.id === id);
      if (!suggestion) throw new Error('反馈依据已变化，请重新确认');
      if (action === 'dismiss') {
        const decisions = await this.decisions(rootPath);
        decisions[key(suggestion.personaId, suggestion.issueType)] = {
          suggestionId: id,
          dismissedAt: new Date().toISOString()
        };
        await mkdir(path.dirname(filename), { recursive: true });
        await resolveArtifactPath(rootPath, decisionPath);
        await writeTextAtomically(filename, JSON.stringify(decisions));
        return;
      }
      if (!text?.trim() || text.length > 4000 || !text.isWellFormed() || text.includes('\0'))
        throw new Error('偏好内容无效');
      const content = patchDocumentFields(`${text.trim()}\n`, {
        kind: 'preference',
        personaId: suggestion.personaId,
        issueType: suggestion.issueType,
        confirmedAt: new Date().toISOString(),
        reviewIds: suggestion.reviewIds
      });
      const target = await this.preferencePath(`review-${id}.md`);
      await withFileWriteLock(target, async () => {
        await mkdir(path.dirname(target), { recursive: true });
        await this.preferencePath(`review-${id}.md`);
        await createTextAtomically(target, content);
      });
    });
    return this.list(rootPath);
  }
}
