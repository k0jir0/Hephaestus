export interface ParsedCommandPlan {
  command: string;
  args: string[];
}

export function parseCommandPlan(command: string): ParsedCommandPlan | null {
  const tokens = command.match(/(?:"[^"]*"|'[^']*'|\S)+/g);
  if (!tokens || tokens.length === 0) {
    return null;
  }

  const [binary, ...args] = tokens.map(normalizeCommandToken);
  if (!binary) {
    return null;
  }

  return { command: binary, args };
}

export function formatCommandInvocation(command: string, args: string[]): string {
  return [command, ...args].join(' ');
}

function normalizeCommandToken(token: string): string {
  return token.replace(/^['"]|['"]$/g, '');
}
