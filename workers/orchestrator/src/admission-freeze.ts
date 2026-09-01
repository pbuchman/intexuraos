import { lstatSync } from 'node:fs';

export const ORCHESTRATOR_ADMISSION_FREEZE_PARENT = '/var/lib';
export const ORCHESTRATOR_ADMISSION_FREEZE_PATH = `${ORCHESTRATOR_ADMISSION_FREEZE_PARENT}/intexuraos-orchestrator-admission.freeze`;

export interface AdmissionFreezeStat {
  uid: number;
  gid: number;
  mode: number;
  nlink: number;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}

export interface AdmissionFreezeDependencies {
  lstat(path: string): AdmissionFreezeStat;
}

function isSafeParent(stat: AdmissionFreezeStat): boolean {
  return (
    stat.uid === 0 &&
    stat.gid === 0 &&
    stat.nlink >= 2 &&
    stat.isDirectory() &&
    !stat.isSymbolicLink() &&
    (stat.mode & 0o22) === 0
  );
}

/**
 * Admission is open only when the canonical persistent parent is trusted and
 * the marker is provably absent. Every present, unsafe, unreadable, or
 * otherwise unknown state fails closed.
 */
export function isOrchestratorAdmissionFrozen(
  dependencies: AdmissionFreezeDependencies = { lstat: lstatSync }
): boolean {
  try {
    if (!isSafeParent(dependencies.lstat(ORCHESTRATOR_ADMISSION_FREEZE_PARENT))) {
      return true;
    }
  } catch {
    return true;
  }

  try {
    dependencies.lstat(ORCHESTRATOR_ADMISSION_FREEZE_PATH);
    // Any present marker freezes admission. Root-side orchestration validates
    // exact metadata before it ever removes the marker.
    return true;
  } catch (error: unknown) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      return false;
    }
    return true;
  }
}
