export interface PromptVars {
  buildUrl: string;
  repo: string;
  clonePath: string;
  pr: string;
  branch: string;
  commit: string;
  failedStage: string;
}

const PLACEHOLDER = /\{(buildUrl|repo|clonePath|pr|branch|commit|failedStage)\}/g;

function allEmpty(text: string, vars: PromptVars): boolean {
  const names = [...text.matchAll(PLACEHOLDER)].map((match) => match[1] as keyof PromptVars);
  return names.length > 0 && names.every((name) => !vars[name]);
}

/**
 * Fills the placeholders, dropping any parenthetical or comma/sentence clause whose placeholders are all
 * empty. A comma left dangling before a dropped sentence-ending clause becomes a full stop.
 */
export function renderPrompt(template: string, vars: PromptVars): string {
  const withoutParens = template.replace(/\s*\([^()]*\)/g, (group) => (allEmpty(group, vars) ? '' : group));
  const kept: string[] = [];
  let droppedEnd: string | undefined;
  const closeRun = () => {
    if (droppedEnd === '.' && kept.length > 0) {
      kept[kept.length - 1] = (kept[kept.length - 1] as string).replace(/,$/, '.');
    }
    droppedEnd = undefined;
  };
  for (const clause of withoutParens.split(/(?<=[.,])\s+/)) {
    if (allEmpty(clause, vars)) {
      droppedEnd = clause.slice(-1);
      continue;
    }
    closeRun();
    kept.push(clause);
  }
  closeRun();
  return kept
    .join(' ')
    .replace(PLACEHOLDER, (_, name: keyof PromptVars) => vars[name])
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,])/g, '$1')
    .trim();
}

export function terminalName(repo: string, job: string, build: number): string {
  return `Claude: ${repo} ${job} #${build}`;
}
