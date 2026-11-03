/**
 * The resume index: which conversations this workspace has seen in which Hermes profile.
 *
 * It lives in `workspaceState` and is *merged*, never rebuilt from a filtered live list — that bug
 * once replaced months of history with the single session that happened to be open.
 */
import type * as vscode from 'vscode';
import {mergeRecent, type RecentSession} from '../domain/RecentSessions';

const KEY = 'recentSessions';
const ACTIVE_KEY = 'activeSession';

export class RecentIndex {
  private signature = '';

  constructor(private readonly state: vscode.Memento, private readonly profile: () => string) {}

  /** Every remembered conversation, in stored order. */
  all(): RecentSession[] {
    const stored = this.state.get<RecentSession[]>(KEY, []);
    return Array.isArray(stored) ? stored.filter(entry => entry && typeof entry.id === 'string') : [];
  }

  /** Entries for the active profile only — the picker never mixes profiles. */
  forProfile(): RecentSession[] {
    const profile = this.profile();
    return this.all().filter(entry => entry.profile === profile);
  }

  find(id: string): RecentSession | undefined {
    const profile = this.profile();
    return this.all().find(entry => entry.id === id && entry.profile === profile);
  }

  activeId(): string {
    return this.state.get<string>(ACTIVE_KEY, '') ?? '';
  }

  setActive(id: string): void {
    if (id && id !== this.activeId()) void this.state.update(ACTIVE_KEY, id);
  }

  /** Keep the stored copy of a renamed conversation in step with the live one. */
  rememberTitle(id: string, title: string): void {
    const all = this.all();
    const entry = all.find(item => item.id === id && item.profile === this.profile());
    if (!entry || entry.title === title) return;
    entry.title = title;
    void this.state.update(KEY, all);
    this.signature = '';
  }

  /**
   * Merge the live sessions into the stored index and persist only when it actually changed.
   * Returns the combined list (all profiles) so the caller can filter once.
   */
  merge(live: {id: string; title: string; cwd: string}[]): RecentSession[] {
    const profile = this.profile();
    const stored = this.all();
    const added = live.map(session => ({id: session.id, title: session.title, cwd: session.cwd, profile}));
    for (const entry of stored) {
      if (entry.profile !== profile) continue;
      const current = live.find(session => session.id === entry.id);
      if (current) entry.title = current.title;
    }
    const combined = mergeRecent(stored, added);
    const signature = JSON.stringify(combined);
    if (signature !== this.signature) {
      this.signature = signature;
      void this.state.update(KEY, combined);
    }
    return combined;
  }

  /** Replace the index with a merge of what Hermes' catalog reported (startup recovery). */
  async recover(discovered: RecentSession[]): Promise<RecentSession[]> {
    const combined = mergeRecent(this.all(), discovered);
    await this.state.update(KEY, combined);
    this.signature = JSON.stringify(combined);
    return combined;
  }
}
