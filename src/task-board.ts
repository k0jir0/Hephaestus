import type { TaskStatus, TaskTicket } from './types.js';

export type TaskSection = 'Queue' | 'In Progress' | 'Completed' | 'Blocked' | 'Cancelled';

const taskSectionOrder: TaskSection[] = [
  'Queue',
  'In Progress',
  'Completed',
  'Blocked',
  'Cancelled',
];

const sectionMetadata: Record<
  TaskSection,
  {
    status: TaskStatus;
    placeholderComment: string;
  }
> = {
  Queue: {
    status: 'pending',
    placeholderComment: '<!-- Tasks are processed top-to-bottom. Add new tasks at the bottom. -->',
  },
  'In Progress': {
    status: 'in_progress',
    placeholderComment: '<!-- Currently working on these tasks -->',
  },
  Completed: {
    status: 'completed',
    placeholderComment: '<!-- Finished tasks will be moved here -->',
  },
  Blocked: {
    status: 'blocked',
    placeholderComment: '<!-- Tasks that need operator attention before they should be retried -->',
  },
  Cancelled: {
    status: 'cancelled',
    placeholderComment: '<!-- Tasks that were superseded, repeated, or explicitly cancelled -->',
  },
};

const statusToSection: Record<TaskStatus, TaskSection> = {
  pending: 'Queue',
  in_progress: 'In Progress',
  planned: 'In Progress',
  awaiting_approval: 'In Progress',
  applying: 'In Progress',
  verifying: 'In Progress',
  completed: 'Completed',
  merged: 'Completed',
  blocked: 'Blocked',
  failed: 'Blocked',
  cancelled: 'Cancelled',
};

const emptySectionItem = '- (empty)';
const taskLinePattern = /^\s*-\s*\[(?: |x|X)\]\s*(.+)$/;
const ticketCommentPattern = /\s*<!--\s*hephaestus-ticket:([A-Za-z0-9_-]+)\s*-->\s*$/i;

export interface ParsedTaskBoardItem {
  id?: string;
  description: string;
  status: TaskStatus;
  sourceOrder: number;
  lineNumber: number;
  section: TaskSection;
}

export function splitMarkdownLines(content: string): string[] {
  return content.split(/\r?\n/);
}

export function extractTaskBoardTicketId(rawTaskText: string): string | undefined {
  const match = rawTaskText.match(ticketCommentPattern);
  return match?.[1];
}

export function formatTaskBoardTicketComment(ticketId?: string): string {
  return ticketId ? ` <!-- hephaestus-ticket:${ticketId} -->` : '';
}

export function normalizeTaskDescription(description: string): string {
  return description
    .replace(ticketCommentPattern, '')
    .replace(/^(?:\*\*IN PROGRESS\*\*:\s*)+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseTaskBoard(content: string): ParsedTaskBoardItem[] {
  const items: ParsedTaskBoardItem[] = [];
  const lines = splitMarkdownLines(content);
  let sourceOrder = 0;

  for (const section of taskSectionOrder) {
    const range = findSectionRange(lines, section);
    if (!range) {
      continue;
    }

    for (let index = range.start; index < range.end; index++) {
      const line = lines[index];
      const match = line.match(taskLinePattern);
      if (!match) {
        continue;
      }

      const description = normalizeTaskDescription(match[1]);
      if (!description || description === '(empty)' || description.startsWith('Example:')) {
        continue;
      }

      sourceOrder += 1;
      items.push({
        id: extractTaskBoardTicketId(match[1]),
        description,
        status: sectionMetadata[section].status,
        sourceOrder,
        lineNumber: index,
        section,
      });
    }
  }

  return items;
}

export function renderTaskBoard(tasks: ReadonlyArray<Pick<TaskTicket, 'id' | 'description' | 'status' | 'sourceOrder'>>): string {
  const grouped = new Map<TaskSection, string[]>();

  for (const section of taskSectionOrder) {
    const entries = tasks
      .filter((task) => statusToSection[task.status] === section)
      .sort((left, right) => left.sourceOrder - right.sourceOrder)
      .map((task) => formatTaskLine(task));

    grouped.set(section, entries.length > 0 ? entries : [emptySectionItem]);
  }

  const sections = taskSectionOrder.flatMap((section) => [
    `## ${section}`,
    '',
    sectionMetadata[section].placeholderComment,
    ...grouped.get(section)!,
    '',
  ]);

  return [
    '# Hephaestus Task Queue',
    '',
    'Add tasks below. The agent processes the Queue section top-to-bottom.',
    '',
    ...sections,
    '---',
    '',
    '**Tip**: Use `- [ ]` for pending tasks. Hephaestus moves tasks between sections as it works.',
    '',
  ].join('\n');
}

function formatTaskLine(task: Pick<TaskTicket, 'id' | 'description' | 'status'>): string {
  const checkbox = ['completed', 'merged', 'cancelled'].includes(task.status) ? '- [x]' : '- [ ]';
  return `${checkbox} ${task.description}${formatTaskBoardTicketComment(task.id)}`;
}

function findSectionRange(
  lines: string[],
  section: TaskSection
): { start: number; end: number } | null {
  const header = `## ${section}`;
  const headerIndex = lines.findIndex((line) => line.trim() === header);
  if (headerIndex === -1) {
    return null;
  }

  let endIndex = lines.length;
  for (let index = headerIndex + 1; index < lines.length; index++) {
    if (/^## /.test(lines[index])) {
      endIndex = index;
      break;
    }
  }

  return {
    start: headerIndex + 1,
    end: endIndex,
  };
}
