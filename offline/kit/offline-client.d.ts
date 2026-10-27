/** Types for the Game Offline Reliability Kit's offline-client.js. */
export interface OfflineStatus {
  coreHave: number;
  coreTotal: number;
  mediaHave: number;
  mediaTotal: number;
  ready: boolean;
}

export interface OfflineEvent {
  type: string;
  message?: string;
  [key: string]: unknown;
}

export interface OfflineManager {
  start(): Promise<void>;
  check(o?: { manual?: boolean }): Promise<{ ok: boolean; reason?: string; waiting?: boolean; remote?: string }>;
  activate(): Promise<boolean>;
  status(deep?: boolean): Promise<OfflineStatus>;
  warm(): Promise<{ ok: boolean; reason?: string }>;
  repair(): Promise<{ ok: boolean; reason?: string }>;
  protectStorage(): Promise<boolean>;
  readonly registration: ServiceWorkerRegistration | null;
}

export function createOfflineManager(o: {
  appId: string;
  buildId: string;
  onStatus?: (e: OfflineEvent) => void;
  beforeReload?: () => unknown;
  onUpdateReady?: (o: { activate: () => Promise<boolean> }) => void;
}): OfflineManager;
