export class AgentRuntimeError extends Error {
  readonly code: string;

  constructor(message: string, code = 'AGENT_RUNTIME_ERROR') {
    super(message);
    this.name = 'AgentRuntimeError';
    this.code = code;
  }
}
