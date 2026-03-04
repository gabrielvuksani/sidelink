import { DeviceListResult, RuntimeMode } from '../types';
import { AppStore } from '../state/store';
import { LogService } from './log-service';
import { DeviceAdapter } from '../adapters/device-adapter';
import { MockDeviceAdapter } from '../adapters/mock-device-adapter';
import { RealDeviceAdapter } from '../adapters/real-device-adapter';

const withCapturedAt = (mode: RuntimeMode, result: Omit<DeviceListResult, 'requestedMode' | 'capturedAt'>): DeviceListResult => ({
  requestedMode: mode,
  source: result.source,
  devices: result.devices,
  note: result.note,
  capturedAt: new Date().toISOString()
});

export class DeviceService {
  private readonly realAdapter: DeviceAdapter;
  private readonly mockAdapter: DeviceAdapter;

  constructor(
    private readonly store: AppStore,
    private readonly logs: LogService,
    realAdapter: DeviceAdapter = new RealDeviceAdapter(),
    mockAdapter: DeviceAdapter = new MockDeviceAdapter()
  ) {
    this.realAdapter = realAdapter;
    this.mockAdapter = mockAdapter;
  }

  public async list(mode: RuntimeMode, forceRefresh = false): Promise<DeviceListResult> {
    if (!forceRefresh) {
      const cached = this.store.getDeviceSnapshot(mode);
      if (cached) {
        return cached;
      }
    }

    const result = await this.fetch(mode);
    this.store.saveDeviceSnapshot(mode, result);
    return result;
  }

  public async getDeviceById(mode: RuntimeMode, deviceId: string, forceRefresh = true): Promise<DeviceListResult['devices'][number] | undefined> {
    const list = await this.list(mode, forceRefresh);
    return list.devices.find((device) => device.id === deviceId);
  }

  private async fetch(mode: RuntimeMode): Promise<DeviceListResult> {
    if (mode === 'demo') {
      const mock = await this.mockAdapter.listDevices();
      return withCapturedAt(mode, {
        source: mock.source,
        devices: mock.devices,
        note: mock.note
      });
    }

    try {
      const available = await this.realAdapter.isAvailable();
      if (available) {
        const real = await this.realAdapter.listDevices();
        return withCapturedAt(mode, {
          source: real.source,
          devices: real.devices,
          note: real.note
        });
      }

      const mock = await this.mockAdapter.listDevices();
      this.logs.push({
        level: 'warn',
        code: 'REAL_ADAPTER_UNAVAILABLE',
        message: 'Real device adapter unavailable. Falling back to mock devices.',
        action: 'Install libimobiledevice (`brew install libimobiledevice`) and reconnect device over USB/Wi‑Fi.'
      });

      return withCapturedAt(mode, {
        source: 'mock-fallback',
        devices: mock.devices,
        note: 'Real adapter unavailable. Showing mock devices for continuity.'
      });
    } catch (error) {
      this.logs.push({
        level: 'error',
        code: 'REAL_ADAPTER_FAILED',
        message: `Real adapter failed: ${error instanceof Error ? error.message : String(error)}`,
        action: 'Reconnect device, unlock iPhone, trust host, then retry discovery.'
      });

      const mock = await this.mockAdapter.listDevices();
      return withCapturedAt(mode, {
        source: 'mock-fallback',
        devices: mock.devices,
        note: 'Real adapter failed. Mock fallback enabled.'
      });
    }
  }
}
