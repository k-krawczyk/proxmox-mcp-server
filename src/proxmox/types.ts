// Partial shapes for the PVE responses this server reads. Only the fields the
// tools rely on are typed; the raw payload is always passed through unchanged so
// nothing useful is hidden from the caller.

export interface PveNode {
  node: string;
  status: 'online' | 'offline' | 'unknown';
  cpu?: number;
  maxcpu?: number;
  mem?: number;
  maxmem?: number;
  uptime?: number;
}

export interface PveClusterResource {
  id: string;
  type: 'node' | 'storage' | 'qemu' | 'lxc' | 'sdn' | 'pool';
  node?: string;
  status?: string;
  vmid?: number;
  name?: string;
  maxcpu?: number;
  maxmem?: number;
  storage?: string;
}

export interface PveGuestStatus {
  status: 'running' | 'stopped' | 'paused' | string;
  vmid: number;
  name?: string;
  uptime?: number;
  cpus?: number;
  maxmem?: number;
}

export interface PveTask {
  upid: string;
  node: string;
  type: string;
  id: string;
  user: string;
  status?: string;
  starttime?: number;
  endtime?: number;
  exitstatus?: string;
}

export interface PveTaskStatus {
  upid: string;
  node: string;
  type: string;
  status: 'running' | 'stopped';
  exitstatus?: string;
  pid?: number;
}

export interface PveStorage {
  storage: string;
  type: string;
  content: string;
  active?: number;
  enabled?: number;
  total?: number;
  used?: number;
  avail?: number;
}

export interface PveStorageContent {
  volid: string;
  content: string;
  format?: string;
  size?: number;
  vmid?: number;
  ctime?: number;
}

export interface PveSnapshot {
  name: string;
  description?: string;
  snaptime?: number;
  parent?: string;
  vmstate?: number;
}

export interface PveNetworkIface {
  iface: string;
  type: string;
  method?: string;
  address?: string;
  cidr?: string;
  gateway?: string;
  bridge_ports?: string;
  active?: number;
  autostart?: number;
}
