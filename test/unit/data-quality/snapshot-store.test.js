import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SnapshotStore } from '../../../src/data-quality/snapshots/snapshot-store.js';

const DAY = 24 * 60 * 60 * 1000;

function makeData(n) {
  const start = new Date('2026-01-01').getTime();
  return Array.from({ length: n }, (_, i) => ({
    date: new Date(start + i * DAY).toISOString().slice(0, 10),
    value: 100 + i
  }));
}

describe('SnapshotStore', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'fl-snapshots-'));
  });

  it('creates snapshots with ids, versions, and hashes', async () => {
    const store = new SnapshotStore({ path: tmpDir, autoSave: false });
    const snap = await store.createSnapshot('sales', makeData(10));

    assert.ok(snap.id.startsWith('snap-'));
    assert.equal(snap.name, 'sales');
    assert.equal(snap.originalSize, 10);
    assert.equal(snap.metadata.version, 1);
    assert.equal(snap.dataHash.length, 64); // SHA-256 hex
  });

  it('increments version numbers per series name', async () => {
    const store = new SnapshotStore({ path: tmpDir, autoSave: false });
    await store.createSnapshot('sales', makeData(5));
    await store.createSnapshot('sales', makeData(6));
    await store.createSnapshot('other', makeData(7));

    const list = store.listSnapshots('sales');
    assert.equal(list.length, 2);
    assert.equal(list[0].version, 2); // newest first
  });

  it('enforces the max versions policy', async () => {
    const store = new SnapshotStore({ path: tmpDir, autoSave: false, maxVersions: 3 });
    for (let i = 0; i < 5; i++) {
      await store.createSnapshot('sales', makeData(i + 1));
    }

    assert.equal(store.listSnapshots('sales').length, 3);
    assert.equal(store.getLatestVersion('sales'), 5);
  });

  it('restores a deep copy of the original data', async () => {
    const store = new SnapshotStore({ path: tmpDir, autoSave: false });
    const data = makeData(4);
    const snap = await store.createSnapshot('sales', data);

    data[0].value = 999; // mutate the source after snapshotting

    const restored = await store.restoreToSnapshot(snap.id);
    assert.equal(restored.success, true);
    assert.equal(restored.data.length, 4);
    assert.equal(restored.data[0].value, 100); // unaffected by later mutation
  });

  it('throws when restoring or deleting an unknown snapshot id', async () => {
    const store = new SnapshotStore({ path: tmpDir, autoSave: false });
    await assert.rejects(() => store.restoreToSnapshot('snap-nope'), /Snapshot not found/);
    await assert.rejects(() => store.deleteSnapshot('snap-nope'), /Snapshot not found/);
  });

  it('deletes a snapshot and updates the listing', async () => {
    const store = new SnapshotStore({ path: tmpDir, autoSave: false });
    const snap = await store.createSnapshot('sales', makeData(3));

    const result = await store.deleteSnapshot(snap.id);
    assert.deepEqual(result, { success: true });
    assert.equal(store.listSnapshots('sales').length, 0);
  });

  it('persists snapshots to disk when autoSave is enabled', async () => {
    const store = new SnapshotStore({ path: tmpDir + '/', autoSave: true });
    await store.createSnapshot('sales', makeData(3));

    const files = readdirSync(tmpDir).filter(f => f.endsWith('.json'));
    assert.equal(files.length, 1);

    // And reloads them from disk into a fresh store
    const fresh = new SnapshotStore({ path: tmpDir + '/', autoSave: false });
    const loaded = await fresh.loadFromDisk();
    assert.equal(loaded, 1);
  });

  it('hashes identical data identically and does not mutate the input order', async () => {
    const store = new SnapshotStore({ autoSave: false });
    const a = makeData(5);
    const b = [...a].reverse(); // same points, different array order

    const hashA = await store.hashData(a);
    const hashB = await store.hashData(b);
    assert.equal(hashA, hashB);
    assert.equal(a[0].value, 100); // input not sorted in place
  });

  it('cleans up snapshots older than N days', async () => {
    const store = new SnapshotStore({ path: tmpDir, autoSave: false });
    const snap = await store.createSnapshot('sales', makeData(3));
    // Backdate it
    const list = store.snapshots.get('sales');
    list[0].timestamp = new Date(Date.now() - 10 * DAY).toISOString();

    const deleted = await store.cleanupOlderThan(5);
    assert.equal(deleted, 1);
    assert.equal(store.listSnapshots('sales').length, 0);
    assert.ok(snap.id);
  });
});
