/**
 * Context attachments: files the chat sends along with the prompt text.
 *
 * The webview only ever sends paths; the extension host reads the bytes, so a webview can never
 * fabricate file contents and a path is re-validated (absolute, regular file, inside a trusted
 * workspace folder, within the size budget) at admission time — not when it was attached.
 */
export const MAX_ATTACHMENTS = 12;
export const MAX_ATTACHMENT_BYTES = 512 * 1024;
export const MAX_ATTACHMENT_TOTAL_BYTES = 1024 * 1024;

export interface AttachmentRequest { path: string; line?: number; }
export interface Attachment extends AttachmentRequest { name: string; size: number; }

/** What the editor currently has focus on, mirrored into the picker. */
export interface ActiveEditorContext { path: string; name: string; line: number; }

export function attachmentLabel(a: { name: string; line?: number }): string {
  return a.line ? `${a.name}:${a.line}` : a.name;
}

/** Prompt carrying the attachments: the question first, then each file fenced for the model. */
export function composePrompt(text: string, attachments: Attachment[], contents: string[]): string {
  const blocks = attachments.map((a, i) =>
    `--- file: ${attachmentLabel(a)} (${a.size} bytes) ---\n${contents[i] ?? ''}\n--- end: ${attachmentLabel(a)} ---`);
  return [`${text.trim()}\n`, ...blocks].join('\n');
}

export function attachmentBudgetError(attachments: Attachment[]): string {
  if (attachments.length > MAX_ATTACHMENTS) return `Attach at most ${MAX_ATTACHMENTS} files.`;
  const oversized = attachments.find(a => a.size > MAX_ATTACHMENT_BYTES);
  if (oversized) return `${oversized.name} is too large (limit ${MAX_ATTACHMENT_BYTES / 1024} KB per file).`;
  const total = attachments.reduce((sum, a) => sum + a.size, 0);
  if (total > MAX_ATTACHMENT_TOTAL_BYTES) return `Attachments total ${Math.round(total / 1024)} KB; the limit is ${MAX_ATTACHMENT_TOTAL_BYTES / 1024} KB.`;
  return '';
}
