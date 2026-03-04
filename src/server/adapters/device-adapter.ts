import { DeviceStatus } from '../types';

export interface DeviceAdapterResult {
  source: 'real' | 'mock';
  devices: DeviceStatus[];
  note?: string;
}

export interface DeviceAdapter {
  readonly name: string;
  isAvailable(): Promise<boolean>;
  listDevices(): Promise<DeviceAdapterResult>;
}
