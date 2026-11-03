/**
 * The two read-only sides of a review diff.
 *
 * Kept free of `vscode` so the URIs and the snapshot registry can be tested without an editor: the
 * only editor-specific step left in the command is calling `vscode.diff` with what this returns.
 */
export const SCHEME = 'praecode-review';

/** URI path components: the record id scopes a snapshot so two reviews never collide. */
export interface DiffSides {
  left: string;
  right: string;
  title: string;
}

export function diffSides(id: string, file: string, before: string | null, after: string | null, reviewOnly = false): DiffSides {
  if (!id) throw new Error('A change id is required');
  const base = file.split(/[\\/]/).pop() || 'file';
  const name = encodeURIComponent(base);
  // Never a `file:` URI: a real path here would make the diff pane editable and let a "review" write.
  return {
    left: `${SCHEME}:/${id}/before/${name}`,
    right: `${SCHEME}:/${id}/after/${name}`,
    title: `${base} — captured before ↔ proposed after${reviewOnly ? ' (review only)' : ''}`
  };
}

/** Bounded snapshot store: content lives here, not in the editor and not in the webview. */
export class SnapshotRegistry {
  private readonly documents = new Map<string, string>();

  constructor(private readonly limit = 40) {}

  get size(): number {
    return this.documents.size;
  }

  /** Remember one side; refuses past the cap so a session cannot pin unbounded text in memory. */
  set(uri: string, text: string): void {
    if (this.documents.has(uri)) {
      this.documents.set(uri, text);
      return;
    }
    if (this.documents.size >= this.limit) throw new Error('Close some review tabs before opening more snapshots');
    this.documents.set(uri, text);
  }

  get(uri: string): string {
    return this.documents.get(uri) ?? 'Snapshot no longer available. Reopen it from Changes.';
  }

  forget(uri: string): void {
    this.documents.delete(uri);
  }

  clear(): void {
    this.documents.clear();
  }
}
