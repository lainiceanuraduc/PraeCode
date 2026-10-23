/**
 * Limits for one webview → host message.
 *
 * The router used to gate every message on `JSON.stringify(message).length > 250_000`, which is a
 * text-shaped assumption. An image arrives as base64 (~4/3 of its bytes), so a perfectly legal
 * 300 KB screenshot — well under the 4 MB per-image limit — was rejected as "Invalid webview
 * message". Limits are therefore per-field: text is small, attachments and images have their own
 * budgets, and the base64 envelope is checked against the image budget it will be measured by.
 */
import {MAX_IMAGES} from './Images';
import {MAX_ATTACHMENTS} from './Attachments';

/** Longest prompt text the composer can send (matches the textarea maxlength). */
export const MAX_PROMPT_CHARS = 200_000;
/** Base64 characters for one image, derived from the per-image byte cap (4/3 inflation). */
export const MAX_IMAGE_B64_CHARS = Math.ceil((4 * 1024 * 1024) * 4 / 3) + 16;
/** Ceiling for a whole message including every image, so one frame cannot exhaust memory. */
export const MAX_MESSAGE_CHARS = MAX_PROMPT_CHARS + MAX_IMAGES * MAX_IMAGE_B64_CHARS + 64 * 1024;

export interface MessageShape { type: string; text?: unknown; images?: unknown; attachments?: unknown; }

/** Returns a human-readable reason the message must be refused, or '' when it is acceptable. */
export function webviewMessageError(message: unknown): string {
  if (!message || typeof message !== 'object') return '';
  const m = message as MessageShape;
  if (typeof m.type !== 'string') return 'Invalid webview message';
  if (typeof m.text === 'string' && m.text.length > MAX_PROMPT_CHARS) {
    return `Message text exceeds ${MAX_PROMPT_CHARS} characters`;
  }
  if (m.attachments !== undefined) {
    if (!Array.isArray(m.attachments)) return 'Invalid attachment list';
    if (m.attachments.length > MAX_ATTACHMENTS) return `Attach at most ${MAX_ATTACHMENTS} files`;
  }
  if (m.images !== undefined) {
    if (!Array.isArray(m.images)) return 'Invalid image list';
    if (m.images.length > MAX_IMAGES) return `Attach at most ${MAX_IMAGES} images`;
    let total = 0;
    for (const image of m.images as { data?: unknown }[]) {
      const data = typeof image?.data === 'string' ? image.data : '';
      if (data.length > MAX_IMAGE_B64_CHARS) return 'An image is too large to attach';
      total += data.length;
    }
    if (total > MAX_IMAGES * MAX_IMAGE_B64_CHARS) return 'The images are too large to attach together';
  }
  return '';
}
