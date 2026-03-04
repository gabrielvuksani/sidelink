import { DeviceAdapter, DeviceAdapterResult } from './device-adapter';

const now = () => new Date().toISOString();

export class MockDeviceAdapter implements DeviceAdapter {
  public readonly name = 'mock-device-adapter';

  public async isAvailable(): Promise<boolean> {
    return true;
  }

  public async listDevices(): Promise<DeviceAdapterResult> {
    const devices = [
      {
        id: 'mock-iphone-15-pro',
        name: 'Gabriel iPhone 15 Pro',
        osVersion: '17.4',
        model: 'iPhone 15 Pro',
        connection: 'online' as const,
        transport: 'wifi' as const,
        networkName: 'Studio-WiFi-5G',
        ipAddress: '192.168.0.58',
        batteryPercent: 84,
        lastSeenAt: now(),
        source: 'mock' as const
      },
      {
        id: 'mock-iphone-se-3',
        name: 'QA iPhone SE',
        osVersion: '16.7',
        model: 'iPhone SE (3rd gen)',
        connection: 'online' as const,
        transport: 'usb' as const,
        batteryPercent: 61,
        lastSeenAt: now(),
        source: 'mock' as const
      },
      {
        id: 'mock-ipad-air',
        name: 'iPad Air Test Bed',
        osVersion: '17.2',
        model: 'iPad Air',
        connection: 'untrusted' as const,
        transport: 'unknown' as const,
        batteryPercent: 42,
        lastSeenAt: now(),
        source: 'mock' as const
      }
    ];

    return {
      source: 'mock',
      devices,
      note: 'Mock fallback enabled. Install libimobiledevice for real USB/Wi‑Fi discovery.'
    };
  }
}
