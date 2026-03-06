import dgram from 'node:dgram';
import os from 'node:os';

const DISCOVERY_PORT = 4011;

export interface DiscoveryPayload {
  service: 'sidelink';
  type: 'sidelink-discovery';
  version: 1;
  name: string;
  port: number;
  addresses: string[];
  timestamp: string;
}

function getIpv4Addresses(): string[] {
  const nets = os.networkInterfaces();
  const out = new Set<string>();
  for (const infos of Object.values(nets)) {
    for (const info of infos ?? []) {
      if (info.family === 'IPv4' && !info.internal) {
        out.add(info.address);
      }
    }
  }
  return Array.from(out);
}

export function startDiscoveryBroadcaster(params: { name: string; port: number }): () => void {
  const socket = dgram.createSocket('udp4');
  let timer: NodeJS.Timeout | undefined;

  const broadcast = () => {
    const payload: DiscoveryPayload = {
      service: 'sidelink',
      type: 'sidelink-discovery',
      version: 1,
      name: params.name,
      port: params.port,
      addresses: getIpv4Addresses(),
      timestamp: new Date().toISOString(),
    };
    const data = Buffer.from(JSON.stringify(payload), 'utf8');

    socket.send(data, DISCOVERY_PORT, '255.255.255.255', () => {});
  };

  socket.bind(() => {
    socket.setBroadcast(true);
    broadcast();
    timer = setInterval(broadcast, 5_000);
  });

  return () => {
    if (timer) clearInterval(timer);
    socket.close();
  };
}
