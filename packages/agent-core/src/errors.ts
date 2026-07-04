export class AgentRuntimeError extends Error {
  readonly code: string;

  constructor(message: string, code = 'AGENT_RUNTIME_ERROR') {
    super(message);
    this.name = 'AgentRuntimeError';
    this.code = code;
  }
}

export function toAgentErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
