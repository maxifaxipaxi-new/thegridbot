import net from 'node:net';
import dgram from 'node:dgram';

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
  'garrys mod': 27015
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
      // In some firewalled TCP games, ECONNREFUSED might happen if UDP-only
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
 * Ping via Steam/Source A2S_INFO query (UDP)
 */
export function pingA2s(host, port, timeout = 1500) {
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

    client.on('message', (msg) => {
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

    // Standard A2S_INFO packet: FF FF FF FF 54 53 6F 75 72 63 65 20 45 6E 67 69 6E 65 20 51 75 65 72 79 00
    const query = Buffer.from([
      0xFF, 0xFF, 0xFF, 0xFF,
      0x54, 0x53, 0x6F, 0x75, 0x72, 0x63, 0x65, 0x20,
      0x45, 0x6E, 0x67, 0x69, 0x6E, 0x65, 0x20, 0x51,
      0x75, 0x65, 0x72, 0x79, 0x00
    ]);

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

  // First try TCP ping
  const tcpResult = await pingTcp(host, port, 1500);
  if (tcpResult.online) {
    statusResult = tcpResult;
  } else {
    // If TCP failed and game is commonly UDP/Steam-based, try A2S query
    const isSourceOrUdp = [
      'valheim', 'palworld', 'cs2', 'counter-strike', 'rust', 'ark',
      'enshrouded', '7 days to die', 'gmod', 'tf2', 'team fortress'
    ].some(t => lowerType.includes(t));

    if (isSourceOrUdp) {
      // Often query port is same port or port + 1 or port + 15
      const a2sResult = await pingA2s(host, port, 1500);
      if (a2sResult.online) {
        statusResult = a2sResult;
      } else {
        // Try port + 1 for steam query port offset
        const a2sResultOffset = await pingA2s(host, port + 1, 1000);
        if (a2sResultOffset.online) {
          statusResult = a2sResultOffset;
        }
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
