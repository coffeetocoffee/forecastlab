/**
 * Snapshot Store - Rollback functionality for Data Quality Engine v2.0
 * 
 * Features:
 * - Create immutable snapshots of data before transformations
 * - Automatic versioning and cleanup policies
 * - File system or database persistence (configurable)
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';

export class SnapshotStore {
  constructor(options = {}) {
    this.snapshots = new Map(); // In-memory cache
    this.history = [];          // Version history log
    this.defaultPath = options.path || './snapshots/';
    this.autoSave = options.autoSave !== false;
    this.maxVersions = options.maxVersions || 10;
  }

  /**
   * Create a snapshot before an operation
   */
  async createSnapshot(name, data, metadata = {}) {
    const snapshotId = this.generateSnapshotId();
    const timestamp = new Date().toISOString();
    
    const snapshot = {
      id: snapshotId,
      name: name || `snapshot-${timestamp}`,
      timestamp,
      dataHash: await this.hashData(data),
      originalSize: data.length,
      metadata: {
        ...metadata,
        created_at: timestamp,
        version: this.getLatestVersion(name) + 1
      },
      data: JSON.parse(JSON.stringify(data)) // Deep copy
    };

    // Store in memory
    if (!this.snapshots.has(name)) {
      this.snapshots.set(name, []);
    }
    
    const seriesSnapshots = this.snapshots.get(name);
    seriesSnapshots.push(snapshot);
    
    // Apply max versions policy
    if (seriesSnapshots.length > this.maxVersions) {
      seriesSnapshots.shift(); // Remove oldest
    }

    // Auto-save to disk
    if (this.autoSave) {
      await this.saveToFile(snapshot);
    }

    // Log to history
    this.history.push({
      action: 'snapshot_created',
      snapshotId,
      name,
      timestamp,
      size: data.length
    });

    console.log(`✅ Snapshot created: ${snapshotId} (${data.length} data points)`);
    
    return snapshot;
  }

  /**
   * Restore data from a specific snapshot
   */
  async restoreToSnapshot(snapshotId) {
    const snapshot = await this.findSnapshotById(snapshotId);
    
    if (!snapshot) {
      throw new Error(`Snapshot not found: ${snapshotId}`);
    }

    console.log(`🔄 Restoring to snapshot ${snapshotId}...`);
    
    const restoredData = JSON.parse(JSON.stringify(snapshot.data));
    
    this.history.push({
      action: 'snapshot_restored',
      snapshotId,
      timestamp: new Date().toISOString(),
      size: restoredData.length
    });

    console.log(`✅ Restored ${restoredData.length} data points`);
    
    return {
      success: true,
      snapshot: snapshot.metadata,
      data: restoredData,
      restorableAt: snapshot.timestamp
    };
  }

  /**
   * List all available snapshots for a dataset
   */
  listSnapshots(name) {
    const seriesSnapshots = this.snapshots.get(name) || [];
    return seriesSnapshots.map(s => ({
      id: s.id,
      name: s.name,
      timestamp: s.timestamp,
      version: s.metadata.version,
      size: s.originalSize,
      hash: s.dataHash.substring(0, 8)
    })).reverse(); // Newest first
  }

  /**
   * Delete a specific snapshot
   */
  async deleteSnapshot(snapshotId) {
    let deleted = false;
    
    for (const [name, snapshots] of this.snapshots.entries()) {
      const index = snapshots.findIndex(s => s.id === snapshotId);
      if (index !== -1) {
        snapshots.splice(index, 1);
        deleted = true;
        
        this.history.push({
          action: 'snapshot_deleted',
          snapshotId,
          name,
          timestamp: new Date().toISOString()
        });
        
        console.log(`✅ Snapshot ${snapshotId} deleted`);
        break;
      }
    }
    
    if (!deleted) {
      throw new Error(`Snapshot not found: ${snapshotId}`);
    }
    
    return { success: true };
  }

  /**
   * Find snapshot by ID
   */
  async findSnapshotById(snapshotId) {
    for (const [name, snapshots] of this.snapshots.entries()) {
      const found = snapshots.find(s => s.id === snapshotId);
      if (found) {
        return found;
      }
    }
    return null;
  }

  /**
   * Get latest version number for a dataset
   */
  getLatestVersion(name) {
    const seriesSnapshots = this.snapshots.get(name) || [];
    if (seriesSnapshots.length === 0) return 0;
    return Math.max(...seriesSnapshots.map(s => s.metadata.version));
  }

  /**
   * Generate unique snapshot ID
   */
  generateSnapshotId() {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `snap-${timestamp}-${random}`;
  }

  /**
   * Hash data for integrity checking
   */
  async hashData(data) {
    const jsonString = JSON.stringify(data.sort((a, b) => 
      (a.date || '').localeCompare(b.date || '')
    ));
    
    const encoder = new TextEncoder();
    const uint8Array = encoder.encode(jsonString);
    const hashBuffer = await crypto.subtle.digest('SHA-256', uint8Array);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Save snapshot to file
   */
  async saveToFile(snapshot) {
    try {
      const fileName = `${snapshot.id}.json`;
      const filePath = `${this.defaultPath}${fileName}`;
      
      // Ensure directory exists
      if (!existsSync(this.defaultPath)) {
        require('fs').mkdirSync(this.defaultPath, { recursive: true });
      }
      
      writeFileSync(filePath, JSON.stringify(snapshot, null, 2));
      
      this.history.push({
        action: 'snapshot_saved',
        snapshotId: snapshot.id,
        path: filePath,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Warning: Could not save snapshot to disk:', error.message);
    }
  }

  /**
   * Load snapshots from disk
   */
  async loadFromDisk() {
    try {
      if (!existsSync(this.defaultPath)) {
        return 0;
      }
      
      const files = require('fs').readdirSync(this.defaultPath);
      let loadedCount = 0;
      
      for (const file of files) {
        if (file.endsWith('.json')) {
          const filePath = `${this.defaultPath}${file}`;
          const content = readFileSync(filePath, 'utf-8');
          const snapshot = JSON.parse(content);
          
          const seriesName = snapshot.name.split('-')[0];
          if (!this.snapshots.has(seriesName)) {
            this.snapshots.set(seriesName, []);
          }
          
          this.snapshots.get(seriesName).push(snapshot);
          loadedCount++;
        }
      }
      
      console.log(`✅ Loaded ${loadedCount} snapshots from disk`);
      return loadedCount;
    } catch (error) {
      console.error('Warning: Could not load snapshots from disk:', error.message);
      return 0;
    }
  }

  /**
   * Get history log
   */
  getHistory(limit = 50) {
    return this.history.slice(-limit);
  }

  /**
   * Cleanup old snapshots (older than N days)
   */
  async cleanupOlderThan(days) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    
    let deletedCount = 0;
    
    for (const [name, snapshots] of this.snapshots.entries()) {
      const toDelete = snapshots.filter(s => new Date(s.timestamp) < cutoffDate);
      
      for (const snapshot of toDelete) {
        await this.deleteSnapshot(snapshot.id);
        deletedCount++;
      }
    }
    
    console.log(`🧹 Cleaned up ${deletedCount} old snapshots`);
    return deletedCount;
  }
}

/**
 * Utility function for easy snapshot creation
 */
export function createSnapshot(name, data, metadata = {}) {
  const store = new SnapshotStore();
  return store.createSnapshot(name, data, metadata);
}

export default SnapshotStore;
