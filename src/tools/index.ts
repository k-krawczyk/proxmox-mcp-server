import type { ToolRegistry } from './registry.js';
import { registerClusterTools } from './cluster.js';
import { registerQemuTools } from './qemu.js';
import { registerLxcTools } from './lxc.js';
import { registerSnapshotTools } from './snapshots.js';
import { registerStorageTools } from './storage.js';
import { registerNetworkTools } from './network.js';
import { registerBackupTools } from './backup.js';

export function registerAllTools(reg: ToolRegistry): void {
  registerClusterTools(reg);
  registerQemuTools(reg);
  registerLxcTools(reg);
  registerSnapshotTools(reg);
  registerStorageTools(reg);
  registerNetworkTools(reg);
  registerBackupTools(reg);
}
