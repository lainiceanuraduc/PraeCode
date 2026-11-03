/**
 * Why a revert must be refused, decided without touching the editor.
 *
 * The journal already refuses a file whose bytes changed; these are the *situational* guards (trust,
 * a live turn, dirty buffers, a target outside every workspace folder). Keeping them pure means the
 * rules can be tested without a VS Code instance, and the modal in `ChangeReview` only asks.
 */
export interface RevertSituation {
  trusted: boolean;
  /** Sessions or workers currently running/starting/cancelling. */
  busy: number;
  /** Sessions whose connection dropped: their edits may still be settling. */
  disconnected: number;
  /** Absolute paths with unsaved editor changes. */
  dirtyPaths: readonly string[];
  /** Workspace folders that may contain the target. */
  workspaceRoots: readonly string[];
}

export function isInside(root: string, target: string): boolean {
  const normalizedRoot = root.replace(/[\\/]+$/, '');
  if (!normalizedRoot) return false;
  const prefix = normalizedRoot + (normalizedRoot.includes('\\') ? '\\' : '/');
  return target === normalizedRoot || target.startsWith(prefix);
}

/** `undefined` when the revert may proceed; otherwise the reason to show the user. */
export function revertBlocker(situation: RevertSituation, target: string): string | undefined {
  if (!situation.trusted) return 'Trust this workspace before reverting a file.';
  if (situation.busy > 0) return 'Wait for all PraeCode turns and workers to finish before reverting.';
  if (situation.disconnected > 0) return 'Reconnect the disconnected conversation before reverting; its edits may still be settling.';
  if (situation.dirtyPaths.some(path => samePath(path, target)))
    return 'This file has unsaved editor changes. Save or discard them before reverting.';
  if (!situation.workspaceRoots.some(root => isInside(root, target)))
    return 'That file is not inside the current workspace.';
  return undefined;
}

function samePath(a: string, b: string): boolean {
  const normalize = (value: string) => value.replace(/\\/g, '/').replace(/\/+$/, '');
  return normalize(a) === normalize(b);
}
