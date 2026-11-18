export type BuildStatus = 'success' | 'failure' | 'unstable' | 'aborted' | 'running' | 'notbuilt';

export function statusFromColor(color: string | undefined): BuildStatus {
  if (!color) return 'notbuilt';
  if (color.endsWith('_anime')) return 'running';
  switch (color) {
    case 'blue':
      return 'success';
    case 'red':
      return 'failure';
    case 'yellow':
      return 'unstable';
    case 'aborted':
      return 'aborted';
    default:
      return 'notbuilt';
  }
}

export function statusFromBuild(
  build: { result?: string | null; building?: boolean } | undefined,
): BuildStatus {
  if (!build) return 'notbuilt';
  if (build.building) return 'running';
  switch (build.result) {
    case 'SUCCESS':
      return 'success';
    case 'FAILURE':
      return 'failure';
    case 'UNSTABLE':
      return 'unstable';
    case 'ABORTED':
      return 'aborted';
    default:
      return 'notbuilt';
  }
}

export function statusFromStage(stageStatus: string | undefined): BuildStatus {
  switch (stageStatus) {
    case 'SUCCESS':
      return 'success';
    case 'FAILED':
      return 'failure';
    case 'UNSTABLE':
      return 'unstable';
    case 'ABORTED':
      return 'aborted';
    case 'IN_PROGRESS':
    case 'PAUSED_PENDING_INPUT':
      return 'running';
    default:
      return 'notbuilt';
  }
}

export interface StatusIcon {
  id: string;
  color?: string;
}

export function iconFor(status: BuildStatus): StatusIcon {
  switch (status) {
    case 'success':
      return { id: 'pass', color: 'testing.iconPassed' };
    case 'failure':
      return { id: 'error', color: 'testing.iconFailed' };
    case 'unstable':
      return { id: 'warning', color: 'list.warningForeground' };
    case 'aborted':
      return { id: 'circle-slash', color: 'disabledForeground' };
    case 'running':
      return { id: 'sync~spin', color: 'charts.blue' };
    case 'notbuilt':
      return { id: 'circle-outline', color: 'disabledForeground' };
  }
}

export function statusWord(status: BuildStatus): string {
  return status === 'notbuilt' ? 'not built' : status;
}
