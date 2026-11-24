import type {
  CommandAck,
  DeviceEventListener,
  DeviceStatus,
  FaultCode,
  FeederConfig,
  FeedingEvent,
  FeedingSchedule,
  PetVisit,
  Snapshot,
} from '../types/device';
import { MockDeviceService } from './mockDevice';
import { RestDeviceService } from './restDevice';

export type DeviceMode = 'hardware' | 'mock';

export interface DeviceService {
  readonly mode: DeviceMode;

  getStatus(): Promise<DeviceStatus>;
  feed(grams: number, force?: boolean): Promise<CommandAck>;
  abort(): Promise<CommandAck>;
  clearFault(): Promise<CommandAck>;
  getSchedule(): Promise<FeedingSchedule[]>;
  putSchedule(slots: FeedingSchedule[]): Promise<CommandAck>;
  getLog(): Promise<FeedingEvent[]>;
  getSnapshot(wake?: boolean): Promise<Snapshot>;
  tare(): Promise<CommandAck>;
  calibrate(knownG: number): Promise<CommandAck & { factor?: number }>;
  setConfig(config: FeederConfig): Promise<CommandAck>;
  getConfig(): Promise<FeederConfig>;
  getPetVisits(): Promise<PetVisit[]>;
  setCamera?(on: boolean): Promise<{ on: boolean }>;
  setFlash?(on: boolean): Promise<{ flash: string }>;
  syncTime?(): Promise<CommandAck>;

  subscribe(listener: DeviceEventListener): () => void;
  reconnect(): Promise<void>;

  readonly demo?: DemoControls;
}

export interface DemoControls {
  simulateConnectionLoss(): void;
  injectFault(code: FaultCode): void;
  triggerVisit(kind?: 'pet' | 'person' | 'other'): void;
  refillHopper(): void;
  emptyBowl(): void;
  reset(): Promise<void>;
}

export { MockDeviceService, RestDeviceService };

export function createDeviceService(mode?: DeviceMode): DeviceService {
  const chosenMode =
    mode ??
    ((import.meta.env.VITE_DEVICE_MODE as DeviceMode) === 'mock' ? 'mock' : 'hardware');

  if (chosenMode === 'hardware') {
    return new RestDeviceService();
  }
  return new MockDeviceService();
}
