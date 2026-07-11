export type SkillInvocation = {
  name: string;
  arguments: string;
};

const SKILL_COMMAND_PATTERN = /^\/skill:([a-z0-9]+(?:-[a-z0-9]+)*)(?:\s+([\s\S]*))?$/;

export function parseSkillInvocation(input: string): SkillInvocation | undefined {
  const match = SKILL_COMMAND_PATTERN.exec(input.trim());

  return match
    ? {
        name: match[1]!,
        arguments: match[2]?.trim() ?? ''
      }
    : undefined;
}

export function formatSkillInvocation(invocation: SkillInvocation) {
  return `/skill:${invocation.name}${invocation.arguments ? ` ${invocation.arguments}` : ''}`;
}
