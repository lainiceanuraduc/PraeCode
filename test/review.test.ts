import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SCHEME, SnapshotRegistry, diffSides} from '../src/extension/review/DiffDocuments';
import {isInside, revertBlocker} from '../src/extension/review/revertGuard';

test('diff sides are read-only review URIs, never file paths', () => {
  const sides = diffSides('abc', '/w/src/app.ts', 'old', 'new');
  assert.equal(sides.left, `${SCHEME}:/abc/before/app.ts`);
  assert.equal(sides.right, `${SCHEME}:/abc/after/app.ts`);
  assert.ok(!sides.left.startsWith('file:'));
  // Two records for the same file must not share a document.
  assert.notEqual(diffSides('one', '/w/a.ts', '', '').left, diffSides('two', '/w/a.ts', '', '').left);
  // The title says when a snapshot is review-only.
  assert.match(diffSides('abc', '/w/src/app.ts', 'old', 'new', true).title, /review only/);
});

test('diff sides reject an empty id and encode a hostile file name', () => {
  assert.throws(() => diffSides('', '/w/a.ts', '', ''), /change id/);
  const sides = diffSides('id', '/w/../etc/pa ss?#.ts', '', '');
  assert.equal(sides.left, `${SCHEME}:/id/before/pa%20ss%3F%23.ts`);
  assert.ok(!sides.left.includes('/etc'));
});

test('the snapshot registry is bounded and forgets closed documents', () => {
  const registry = new SnapshotRegistry(2);
  registry.set('a', '1');
  registry.set('b', '2');
  assert.throws(() => registry.set('c', '3'), /Close some review tabs/);
  assert.equal(registry.get('a'), '1');
  registry.forget('a');
  registry.set('c', '3');
  assert.equal(registry.size, 2);
  registry.clear();
  assert.match(registry.get('c'), /no longer available/);
});

test('a revert is refused for every situation the modal cannot fix', () => {
  const base = {trusted: true, busy: 0, disconnected: 0, dirtyPaths: [], workspaceRoots: ['/w']};
  assert.equal(revertBlocker(base, '/w/src/a.ts'), undefined);
  assert.match(revertBlocker({...base, trusted: false}, '/w/a.ts')!, /Trust this workspace/);
  assert.match(revertBlocker({...base, busy: 1}, '/w/a.ts')!, /Wait for all PraeCode turns/);
  assert.match(revertBlocker({...base, disconnected: 1}, '/w/a.ts')!, /Reconnect/);
  assert.match(revertBlocker({...base, dirtyPaths: ['/w/a.ts']}, '/w/a.ts')!, /unsaved editor changes/);
  assert.match(revertBlocker({...base, workspaceRoots: ['/other']}, '/w/a.ts')!, /not inside the current workspace/);
  // A sibling directory that merely shares a prefix is not inside the workspace.
  assert.match(revertBlocker({...base, workspaceRoots: ['/w']}, '/w-other/a.ts')!, /not inside/);
});

test('workspace containment uses path boundaries, not string prefixes', () => {
  assert.equal(isInside('/w', '/w/a.ts'), true);
  assert.equal(isInside('/w/', '/w/a/b.ts'), true);
  assert.equal(isInside('/w', '/w-other/a.ts'), false);
  assert.equal(isInside('/w', '/w'), true);
  assert.equal(isInside('', '/w/a.ts'), false);
});
