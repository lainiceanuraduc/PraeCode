import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MAX_IMAGE_B64_CHARS,MAX_MESSAGE_CHARS,MAX_PROMPT_CHARS,webviewMessageError} from '../src/domain/MessageLimits';
import {MAX_ATTACHMENTS} from '../src/domain/Attachments';
import {MAX_IMAGES,base64Bytes,imageBudgetError} from '../src/domain/Images';

/** A base64 payload of roughly `bytes` decoded size, with a real PNG signature. */
function image(bytes: number) {
  const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const body = Buffer.alloc(Math.max(0, bytes - header.length), 0x41);
  return { name: 'shot.png', data: Buffer.concat([header, body]).toString('base64') };
}

test('a screenshot well under the per-image cap is accepted (regression: 250k blanket limit)', () => {
  // 400 KB decoded → ~547k base64 chars: legal, but the old JSON.stringify gate refused it.
  const message = { type: 'send', id: 's', text: 'look', images: [image(400 * 1024)] };
  assert.ok(message.images[0].data.length > 250_000, 'the fixture really is bigger than the old limit');
  assert.equal(webviewMessageError(message), '');
  assert.ok(JSON.stringify(message).length <= MAX_MESSAGE_CHARS);
});

test('the largest allowed image still fits a message', () => {
  const atCap = { type: 'send', text: '', images: [image(4 * 1024 * 1024 - 16)] };
  assert.ok(atCap.images[0].data.length <= MAX_IMAGE_B64_CHARS);
  assert.equal(webviewMessageError(atCap), '');
});

test('image count, per-image size, text length and attachment count are refused with a reason', () => {
  assert.match(webviewMessageError({ type: 'send', images: Array.from({ length: MAX_IMAGES + 1 }, () => image(64)) }), /at most 8 images/);
  assert.match(webviewMessageError({ type: 'send', images: [{ data: 'A'.repeat(MAX_IMAGE_B64_CHARS + 4) }] }), /too large/);
  assert.match(webviewMessageError({ type: 'send', text: 'x'.repeat(MAX_PROMPT_CHARS + 1) }), /exceeds/);
  assert.match(webviewMessageError({ type: 'send', attachments: Array.from({ length: MAX_ATTACHMENTS + 1 }, () => ({})) }), /at most 12 files/);
  assert.match(webviewMessageError({ type: 42 }), /Invalid webview message/);
  assert.equal(webviewMessageError(null), '', 'a non-object is ignored by the router, not an error');
});

test('the image budget and the message limit agree on the same ceiling', () => {
  const oneImage = image(4 * 1024 * 1024);
  assert.ok(base64Bytes(oneImage.data) <= 4 * 1024 * 1024 + 8);
  assert.equal(imageBudgetError([{ name: 'a.png', size: base64Bytes(oneImage.data) }]), '');
  assert.ok(MAX_MESSAGE_CHARS > MAX_IMAGES * MAX_IMAGE_B64_CHARS);
});
