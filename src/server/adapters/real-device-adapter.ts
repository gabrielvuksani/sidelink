import { DeviceAdapter, DeviceAdapterResult } from './device-adapter';
import { commandExists, runCommand } from '../utils/command';

const readInfoValue = async (udid: string, key: string): Promise<string | undefined> => {
  const result = await runCommand('ideviceinfo', ['-u', udid, '-k', key], 4000);
  if (result.code !== 0 || !result.stdout) {
    return undefined;
  }

  return result.stdout.split('\n')[0]?.trim();
};

const listIds = async (networkOnly: boolean): Promise<string[]> => {
  const args = networkOnly ? ['-n'] : ['-l'];
  const result = await runCommand('idevice_id', args, 5000);
  if (result.code !== 0) {
    return [];
  }

  return result.stdout
    .split('\n')
    .map((entry) => entry.trim())
    .filter(Boolean);
};

export class RealDeviceAdapter implements DeviceAdapter {
  public readonly name = 'real-device-adapter';

  public async isAvailable(): Promise<boolean> {
    const [hasIdeviceId, hasIdeviceInfo] = await Promise.all([commandExists('idevice_id'), commandExists('ideviceinfo')]);
    return hasIdeviceId && hasIdeviceInfo;
  }

  public async listDevices(): Promise<DeviceAdapterResult> {
    const [usbIds, wifiIds] = await Promise.all([listIds(false), listIds(true)]);

    const idSet = new Set([...usbIds, ...wifiIds]);
    const ids = Array.from(idSet);

    if (!ids.length) {
      return {
        source: 'real',
        devices: [],
        note: 'No connected trusted devices found. Connect over USB or ensure Wi‑Fi pairing is active.'
      };
    }

    const devices = await Promise.all(
      ids.map(async (udid) => {
        const [name, version, productType, wifiAddress] = await Promise.all([
          readInfoValue(udid, 'DeviceName'),
          readInfoValue(udid, 'ProductVersion'),
          readInfoValue(udid, 'ProductType'),
          readInfoValue(udid, 'WiFiAddress')
        ]);

        const transport: 'wifi' | 'usb' | 'unknown' = wifiIds.includes(udid)
          ? 'wifi'
          : usbIds.includes(udid)
            ? 'usb'
            : 'unknown';

        return {
          id: udid,
          name: name ?? `iOS Device ${udid.slice(0, 6)}`,
          osVersion: version ?? 'unknown',
          model: productType ?? 'unknown',
          connection: 'online' as const,
          transport,
          batteryPercent: undefined,
          lastSeenAt: new Date().toISOString(),
          source: 'real' as const,
          ipAddress: undefined,
          networkName: wifiAddress ? `Wi‑Fi (${wifiAddress})` : undefined
        };
      })
    );

    const wifiCount = devices.filter((device) => device.transport === 'wifi').length;
    const usbCount = devices.filter((device) => device.transport === 'usb').length;

    return {
      source: 'real',
      devices,
      note: `Using libimobiledevice adapter (${wifiCount} Wi‑Fi, ${usbCount} USB).`
    };
  }
}
