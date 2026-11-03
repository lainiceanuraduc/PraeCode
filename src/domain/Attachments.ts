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

/**
 * Credential-shaped paths are never attached, mirrored into the editor chip, or listed in the picker.
 *
 * Attachment contents are sent to the model provider, so a workspace `.env` (or a private key inside
 * the repo) would leave the machine in a prompt. Templates such as `.env.example` are documentation
 * and stay attachable; the rule is the *file name*, because a path alone cannot prove what is inside.
 */
const ENV_TEMPLATE = /^\.env\.(example|sample|template|dist|defaults|schema)$/;
const SECRET_NAMES = new Set([
  '.env', '.netrc', '.npmrc', '.pypirc', '.htpasswd', '.git-credentials', 'auth.json',
  'credentials', 'credentials.json', 'secrets', 'secrets.json', 'secrets.yaml', 'secrets.yml',
  'id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519', 'kubeconfig', '.kube/config'
]);
const SECRET_EXTENSIONS = /\.(pem|key|p12|pfx|keystore|jks|kdbx|ppk|gpg|asc|ovpn)$/i;
const SECRET_DIRECTORIES = new Set(['.git', '.ssh', '.gnupg']);

/** Why this path may not be attached, or undefined when it may. */
export function secretFileReason(relativeOrName: string): string | undefined {
  const parts = String(relativeOrName || '').split(/[\\/]/).filter(Boolean);
  const base = (parts.at(-1) ?? '').toLowerCase();
  if (!base) return undefined;
  if (SECRET_DIRECTORIES.has(base) || parts.some(part => SECRET_DIRECTORIES.has(part.toLowerCase()) && part !== parts.at(-1)))
    return 'files under .git, .ssh or .gnupg are never attached';
  if (ENV_TEMPLATE.test(base)) return undefined;
  if (base === '.env' || base.startsWith('.env.')) return '.env files hold credentials; attach a template such as .env.example instead';
  if (SECRET_NAMES.has(base)) return `${base} is a credential file and is never attached`;
  if (SECRET_EXTENSIONS.test(base)) return 'key and certificate files are never attached';
  return undefined;
}
