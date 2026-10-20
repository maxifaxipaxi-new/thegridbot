import net from 'node:net';
import dgram from 'node:dgram';
import { exec } from 'node:child_process';

// Default port mappings for known game types
const DEFAULT_PORTS = {
  minecraft: 25565,
  'minecraft java': 25565,
  'minecraft bedrock': 19132,
  valheim: 2456,
  palworld: 8211,
  cs2: 27015,
  'counter-strike 2': 27015,
  csgo: 27015,
  rust: 28015,
  ark: 7777,
  'ark: survival evolved': 7777,
  enshrouded: 15636,
  terraria: 7777,
  '7 days to die': 26900,
  'project zomboid': 16261,
  'assetto corsa': 9600,
  'team fortress 2': 27015,
  factorio: 34197,
  gmod: 27015,
  'garrys mod': 27015,
  wreckfest: 27007
};

// Cache status for 30 seconds to prevent hammering game servers and keep web response snappy
const statusCache = new Map();
const CACHE_TTL_MS = 30 * 1000;

/**
 * Parse host and port from inputs
 */
export function parseServerAddress(hostStr, portInput, gameType = '') {
  let host = (hostStr || '').trim();
  let port = portInput ? parseInt(portInput, 10) : null;

  // Check if host contains port like mc.thegridcom.org:25565 or 127.0.0.1:8211
  if (host.includes(':')) {
    const parts = host.split(':');
    host = parts[0];
    const parsedPort = parseInt(parts[1], 10);
    if (!isNaN(parsedPort) && parsedPort > 0) {
      port = parsedPort;
    }
  }

  if (!port || isNaN(port)) {
    const lowerType = (gameType || '').toLowerCase().trim();
    port = DEFAULT_PORTS[lowerType] || 25565;
  }

  return { host, port };
}

/**
 * Ping via TCP socket
 */
export function pingTcp(host, port, timeout = 1500) {
  const start = Date.now();
  return new Promise((resolve) => {
    let resolved = false;
    const socket = new net.Socket();

    const finish = (result) => {
      if (!resolved) {
        resolved = true;
        socket.removeAllListeners();
        socket.destroy();
        resolve(result);
      }
    };

    socket.setTimeout(timeout);

    socket.on('connect', () => {
      const latency = Math.max(1, Date.now() - start);
      finish({ online: true, latency });
    });

    socket.on('timeout', () => {
      finish({ online: false, error: 'Timeout', latency: null });
    });

    socket.on('error', (err) => {
      finish({ online: false, error: err.code || err.message, latency: null });
    });

    try {
      socket.connect(port, host);
    } catch (err) {
      finish({ online: false, error: err.message, latency: null });
    }
  });
}

/**
 * Ping via Steam/Source A2S_INFO query (UDP) with challenge support
 */
export function pingA2s(host, port, timeout = 1200) {
  const start = Date.now();
  return new Promise((resolve) => {
    let resolved = false;
    let client;

    try {
      client = dgram.createSocket('udp4');
    } catch (err) {
      return resolve({ online: false, error: err.message, latency: null });
    }

    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        try { client.close(); } catch (e) {}
        resolve({ online: false, error: 'Timeout', latency: null });
      }
    }, timeout);

    const query = Buffer.from([
      0xFF, 0xFF, 0xFF, 0xFF,
      0x54, 0x53, 0x6F, 0x75, 0x72, 0x63, 0x65, 0x20,
      0x45, 0x6E, 0x67, 0x69, 0x6E, 0x65, 0x20, 0x51,
      0x75, 0x65, 0x72, 0x79, 0x00
    ]);

    client.on('message', (msg) => {
      // If Steam sends a challenge response (0x41), resend with challenge
      if (msg[4] === 0x41 && msg.length >= 9) {
        const challenge = msg.slice(5, 9);
        const resend = Buffer.concat([query, challenge]);
        try {
          client.send(resend, 0, resend.length, port, host);
        } catch (e) {}
        return;
      }

      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        const latency = Math.max(1, Date.now() - start);
        try { client.close(); } catch (e) {}
        resolve({ online: true, latency });
      }
    });

    client.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        try { client.close(); } catch (e) {}
        resolve({ online: false, error: err.code || err.message, latency: null });
      }
    });

    try {
      client.send(query, 0, query.length, port, host);
    } catch (err) {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        try { client.close(); } catch (e) {}
        resolve({ online: false, error: err.message, latency: null });
      }
    }
  });
}

/**
 * Ping via ICMP as reliable fallback for hosting providers with UDP query filtering
 */
export function pingIcmp(host) {
  return new Promise((resolve) => {
    const cleanHost = (host || '').trim();
    if (!cleanHost || /[^a-zA-Z0-9.-]/.test(cleanHost)) {
      return resolve({ online: false, latency: null });
    }

    const start = Date.now();
    let cmd = `ping -c 1 -W 2 ${cleanHost}`;
    if (process.platform === 'darwin') {
      cmd = `ping -c 1 -t 2 ${cleanHost}`;
    } else if (process.platform === 'win32') {
      cmd = `ping -n 1 -w 2000 ${cleanHost}`;
    }

    exec(cmd, { timeout: 2500 }, (err, stdout) => {
      if (err) {
        return resolve({ online: false, latency: null });
      }
      const match = stdout.match(/time[=<]([0-9.]+)\s*ms/i);
      const latency = match ? Math.round(parseFloat(match[1])) : Math.max(1, Date.now() - start);
      resolve({ online: true, latency });
    });
  });
}

/**
 * Check game server status with smart protocol fallback & caching
 */
export async function checkServerStatus(server, forceRefresh = false) {
  const cacheKey = `${server.id || 'new'}_${server.host}_${server.port || ''}`;
  if (!forceRefresh && statusCache.has(cacheKey)) {
    const cached = statusCache.get(cacheKey);
    if (Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return cached.data;
    }
  }

  const { host, port } = parseServerAddress(server.host, server.port, server.game_type);
  const lowerType = (server.game_type || '').toLowerCase();

  let statusResult = { online: false, latency: null };

  // 1. Try TCP socket ping
  const tcpResult = await pingTcp(host, port, 1200);
  if (tcpResult.online) {
    statusResult = tcpResult;
  } else {
    // 2. Try UDP/A2S query on port and offsets for games that use Steam / Source
    const isSourceOrUdp = [
      'wreckfest', 'valheim', 'palworld', 'cs2', 'counter-strike', 'rust', 'ark',
      'enshrouded', '7 days to die', 'gmod', 'tf2', 'team fortress', 'terraria',
      'assetto corsa', 'project zomboid'
    ].some(t => lowerType.includes(t));

    if (isSourceOrUdp) {
      // Try configured port
      const a2s1 = await pingA2s(host, port, 800);
      if (a2s1.online) {
        statusResult = a2s1;
      } else {
        // Try Nitrado query port offset (port + 1)
        const a2s2 = await pingA2s(host, port + 1, 800);
        if (a2s2.online) {
          statusResult = a2s2;
        } else if (port > 1) {
          // Try port - 1
          const a2s3 = await pingA2s(host, port - 1, 800);
          if (a2s3.online) {
            statusResult = a2s3;
          }
        }
      }
    }

    // 3. If still offline, try ICMP ping fallback (host is alive and reachable)
    if (!statusResult.online) {
      const icmpResult = await pingIcmp(host);
      if (icmpResult.online) {
        statusResult = icmpResult;
      }
    }
  }

  const finalData = {
    online: statusResult.online,
    latency: statusResult.latency,
    host,
    port,
    checkedAt: Date.now()
  };

  statusCache.set(cacheKey, { timestamp: Date.now(), data: finalData });
  return finalData;
}

/**
 * Calculate human-readable expiration details
 */
export function getExpirationInfo(expiresAt) {
  if (!expiresAt || expiresAt <= 0) {
    return {
      isPermanent: true,
      isExpired: false,
      text: 'Dauerhaft aktiv',
      shortText: '♾️ Dauerhaft',
      badgeClass: 'badge-permanent',
      daysRemaining: null,
      dateFormatted: 'Unbegrenzt',
      color: '#38bdf8'
    };
  }

  const expMs = typeof expiresAt === 'number' ? expiresAt : parseInt(expiresAt, 10);
  const now = Date.now();
  const diffMs = expMs - now;

  const dateObj = new Date(expMs);
  const day = String(dateObj.getDate()).padStart(2, '0');
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const year = dateObj.getFullYear();
  const hours = String(dateObj.getHours()).padStart(2, '0');
  const minutes = String(dateObj.getMinutes()).padStart(2, '0');
  const dateFormatted = `${day}.${month}.${year} ${hours}:${minutes}`;

  if (diffMs <= 0) {
    return {
      isPermanent: false,
      isExpired: true,
      text: `Abgelaufen (${day}.${month}.${year})`,
      shortText: '⚠️ Abgelaufen',
      badgeClass: 'badge-expired',
      daysRemaining: 0,
      dateFormatted,
      color: '#ef4444'
    };
  }

  const totalHours = Math.floor(diffMs / (1000 * 60 * 60));
  const totalDays = Math.floor(totalHours / 24);
  const remainingHours = totalHours % 24;

  let text = '';
  let shortText = '';
  let badgeClass = 'badge-active';
  let color = '#22c55e';

  if (totalDays > 30) {
    const months = Math.floor(totalDays / 30);
    const restDays = totalDays % 30;
    text = `Noch ca. ${months} ${months === 1 ? 'Monat' : 'Monate'}${restDays > 0 ? ` und ${restDays} Tage` : ''} (bis ${day}.${month}.${year})`;
    shortText = `noch ${totalDays} Tage`;
  } else if (totalDays >= 1) {
    text = `Noch ${totalDays} ${totalDays === 1 ? 'Tag' : 'Tage'}${remainingHours > 0 ? ` & ${remainingHours} Std.` : ''} (bis ${day}.${month}.${year})`;
    shortText = `noch ${totalDays} Tage`;
    if (totalDays <= 3) {
      badgeClass = 'badge-expiring-soon';
      color = '#f59e0b';
    }
  } else {
    text = `Noch ${Math.max(1, totalHours)} ${totalHours === 1 ? 'Stunde' : 'Stunden'} (läuft heute ab!)`;
    shortText = `noch ${Math.max(1, totalHours)} Std.`;
    badgeClass = 'badge-expiring-soon';
    color = '#f59e0b';
  }

  return {
    isPermanent: false,
    isExpired: false,
    text,
    shortText,
    badgeClass,
    daysRemaining: totalDays,
    dateFormatted,
    color
  };
}
