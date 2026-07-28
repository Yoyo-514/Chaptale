export type TaskStoredOutput =
  | { kind: 'raw'; runId: string; rawText: string }
  | { kind: 'review'; runId: string; output: unknown };

export type TaskOutputStorePort = {
  saveSuccess(input: {
    runId: string;
    isReview: boolean;
    output: unknown;
    rawText: string;
    cwd: string;
  }): Promise<string>;
  saveFailure(input: { runId: string; rawText: string; cwd: string }): Promise<string>;
  read(outputRef: string): Promise<TaskStoredOutput | null>;
  remove(outputRef: string, cwd: string): Promise<void>;
};
