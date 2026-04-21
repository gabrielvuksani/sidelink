import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DeviceInfo } from '../src/shared/types';

const listAllDevices = vi.fn(async () => [] as DeviceInfo[]);
const installApp = vi.fn(async () => {});
const installAppWifi = vi.fn(async () => {});
const ensurePmd3Available = vi.fn(async () => {});
const pairDevice = vi.fn(async () => {});

vi.mock('../src/server/adapters/device-adapter', () => ({
  listAllDevices,
  installApp,
  installAppWifi,
  ensurePmd3Available,
  pairDevice,
}));

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

describe('DeviceService install routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses USB install for usb transport', async () => {
    const { DeviceService } = await import('../src/server/services/device-service');
    listAllDevices.mockResolvedValueOnce([
      {
        udid: 'usb-1',
        name: 'USB Phone',
        model: 'iPhone',
        productType: 'iPhone15,2',
        iosVersion: '18.0',
        connection: 'online',
        transport: 'usb',
        wifiAddress: null,
        paired: true,
      },
    ]);

    const service = new DeviceService(makeLogger() as any);
    await service.refresh();
    await service.installApp('usb-1', '/tmp/app.ipa');

    expect(installApp).toHaveBeenCalledWith('usb-1', '/tmp/app.ipa');
    expect(installAppWifi).not.toHaveBeenCalled();
  });

  it('uses Wi-Fi RSD install when endpoint is available', async () => {
    const { DeviceService } = await import('../src/server/services/device-service');
    listAllDevices.mockResolvedValueOnce([
      {
        udid: 'wifi-1',
        name: 'WiFi Phone',
        model: 'iPhone',
        productType: 'iPhone15,2',
        iosVersion: '18.0',
        connection: 'online',
        transport: 'wifi',
        wifiAddress: '192.168.1.20:58783',
        paired: true,
      },
    ]);

    const service = new DeviceService(makeLogger() as any);
    await service.refresh();
    await service.installApp('wifi-1', '/tmp/app.ipa');

    expect(installAppWifi).toHaveBeenCalledWith('192.168.1.20', 58783, '/tmp/app.ipa');
    expect(installApp).not.toHaveBeenCalled();
  });

  it('falls back to UDID install if Wi-Fi endpoint is missing', async () => {
    const { DeviceService } = await import('../src/server/services/device-service');
    listAllDevices.mockResolvedValueOnce([
      {
        udid: 'wifi-2',
        name: 'WiFi Phone',
        model: 'iPhone',
        productType: 'iPhone15,2',
        iosVersion: '18.0',
        connection: 'online',
        transport: 'wifi',
        wifiAddress: null,
        paired: true,
      },
    ]);

    const service = new DeviceService(makeLogger() as any);
    await service.refresh();
    await service.installApp('wifi-2', '/tmp/app.ipa');

    expect(installApp).toHaveBeenCalledWith('wifi-2', '/tmp/app.ipa');
    expect(installAppWifi).not.toHaveBeenCalled();
  });
});
