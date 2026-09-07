import type { ReviewJob } from './review-workflow';

export const REVIEW_ISSUE_LABELS: Record<string, string> = {
  timeline: '时间线',
  world_rule: '设定规则',
  item_state: '物件状态',
  fact_conflict: '事实冲突',
  premature_reveal: '提前揭露',
  ooc: '人物行为',
  voice_mismatch: '人物语气',
  knowledge_leak: '知识越界',
  emotion_break: '情感断裂',
  weak_motivation: '动机不足',
  style_drift: '文风偏移',
  flat_rhythm: '节奏平淡',
  over_explaining: '过度解释',
  mechanical_emotion: '情绪直述',
  unnatural_dialogue: '对白生硬'
};
export type ReviewPreference = {
  id: string;
  personaId: ReviewJob['personaId'];
  issueType: string;
  text: string;
  sourceRef: string;
  contentHash: string;
};
export type ReviewFeedbackSuggestion = {
  id: string;
  personaId: ReviewJob['personaId'];
  issueType: string;
  ignoredCount: number;
  text: string;
  reviewIds: string[];
};
export type ReviewFeedbackList = {
  suggestions: ReviewFeedbackSuggestion[];
  preferences: ReviewPreference[];
  diagnostics: string[];
};
