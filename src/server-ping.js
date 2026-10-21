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
        try { client.close(); } catch (e) { }
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
        } catch (e) { }
        return;
      }

      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        const latency = Math.max(1, Date.now() - start);
        try { client.close(); } catch (e) { }
        resolve({ online: true, latency });
      }
    });

    client.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        try { client.close(); } catch (e) { }
        resolve({ online: false, error: err.code || err.message, latency: null });
      }
    });

    try {
      client.send(query, 0, query.length, port, host);
    } catch (err) {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        try { client.close(); } catch (e) { }
        resolve({ online: false, error: err.message, latency: null });
      }
    }
  });
}

/**
 * Query Steam / Source A2S across potential query ports concurrently
 * Handles Nitrado offsets (+1, +20 for Wreckfest, +10), standard Steam ports (27015, 27016 for ETS2, 27017)
 */
export function pingA2sSmart(host, basePort, timeout = 1500) {
  const portsToTry = new Set();
  const numPort = basePort ? parseInt(basePort, 10) : null;
  if (numPort && !isNaN(numPort) && numPort > 0) {
    portsToTry.add(numPort);
    portsToTry.add(numPort + 1);  // Standard Nitrado query port
    portsToTry.add(numPort + 20); // Nitrado Wreckfest offset
    portsToTry.add(numPort + 10);
    if (numPort > 1) portsToTry.add(numPort - 1);
  }
  // Common Steam query ports (e.g. 27016 used by Euro Truck Simulator 2 dedicated server)
  portsToTry.add(27015);
  portsToTry.add(27016);
  portsToTry.add(27017);

  const ports = Array.from(portsToTry);

  return new Promise((resolve) => {
    let resolved = false;
    let pending = ports.length;

    ports.forEach(p => {
      pingA2s(host, p, timeout).then(res => {
        if (res.online && !resolved) {
          resolved = true;
          return resolve(res);
        }
        pending--;
        if (pending === 0 && !resolved) {
          resolve({ online: false, latency: null });
        }
      }).catch(() => {
        pending--;
        if (pending === 0 && !resolved) {
          resolve({ online: false, latency: null });
        }
      });
    });
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
 * Helper to write Minecraft VarInt
 */
function writeVarInt(value) {
  const bytes = [];
  while (true) {
    if ((value & ~0x7F) === 0) {
      bytes.push(value);
      return Buffer.from(bytes);
    }
    bytes.push((value & 0x7F) | 0x80);
    value >>>= 7;
  }
}

/**
 * Helper to read Minecraft VarInt
 */
function readVarInt(buffer, offset = 0) {
  let result = 0;
  let numRead = 0;
  let b;
  do {
    if (offset + numRead >= buffer.length) return null;
    b = buffer[offset + numRead];
    result |= (b & 0x7F) << (7 * numRead);
    numRead++;
    if (numRead > 5) return null;
  } while ((b & 0x80) !== 0);
  return { value: result, length: numRead };
}

/**
 * Ping Minecraft Java Edition via Server List Ping (SLP) over TCP (gameport)
 */
export function pingMinecraft(host, port = 25565, timeout = 3000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const socket = new net.Socket();
    let resolved = false;
    let received = Buffer.alloc(0);

    const finish = (res) => {
      if (!resolved) {
        resolved = true;
        socket.removeAllListeners();
        socket.destroy();
        resolve(res);
      }
    };

    socket.setTimeout(timeout);

    socket.on('connect', () => {
      try {
        const hostBuf = Buffer.from(host, 'utf8');
        const protoVer = writeVarInt(765);
        const hostLen = writeVarInt(hostBuf.length);
        const portBuf = Buffer.alloc(2);
        portBuf.writeUInt16BE(port);
        const nextState = writeVarInt(1); // 1 = status

        const payload = Buffer.concat([writeVarInt(0), protoVer, hostLen, hostBuf, portBuf, nextState]);
        const handshake = Buffer.concat([writeVarInt(payload.length), payload]);
        const statusReq = Buffer.from([0x01, 0x00]);

        socket.write(Buffer.concat([handshake, statusReq]));
      } catch (e) {
        finish({ online: false, latency: null, players: null, error: e.message });
      }
    });

    socket.on('data', (chunk) => {
      received = Buffer.concat([received, chunk]);
      const latency = Math.max(1, Date.now() - start);

      try {
        let offset = 0;
        const packetLen = readVarInt(received, offset);
        if (!packetLen) return;
        offset += packetLen.length;

        if (received.length < offset + packetLen.value) {
          return; // need more data
        }

        const packetId = readVarInt(received, offset);
        if (!packetId) return;
        offset += packetId.length;

        const strLen = readVarInt(received, offset);
        if (!strLen) return;
        offset += strLen.length;

        if (received.length >= offset + strLen.value) {
          const jsonStr = received.subarray(offset, offset + strLen.value).toString('utf8');
          const data = JSON.parse(jsonStr);
          const sample = Array.isArray(data.players?.sample)
            ? data.players.sample.map(p => ({
                id: p.id || '',
                name: p.name || 'Unbekannt'
              }))
            : [];
          finish({
            online: true,
            latency,
            players: {
              online: Number(data.players?.online ?? 0),
              max: Number(data.players?.max ?? 0),
              sample
            },
            version: data.version?.name || null
          });
        }
      } catch (err) { }
    });

    socket.on('timeout', () => finish({ online: false, latency: null, players: null, error: 'Timeout' }));
    socket.on('error', (err) => finish({ online: false, latency: null, players: null, error: err.code || err.message }));
    socket.on('close', () => finish({ online: false, latency: null, players: null, error: 'Closed' }));

    try {
      socket.connect(port, host);
    } catch (err) {
      finish({ online: false, latency: null, players: null, error: err.message });
    }
  });
}

/**
 * Ping Minecraft Bedrock Edition via RakNet UDP (port 19132)
 */
export function pingMinecraftBedrock(host, port = 19132, timeout = 2000) {
  return new Promise((resolve) => {
    const start = Date.now();
    let client;
    try {
      client = dgram.createSocket('udp4');
    } catch (e) {
      return resolve({ online: false, latency: null, players: null, error: e.message });
    }

    let resolved = false;
    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        try { client.close(); } catch (e) { }
        resolve({ online: false, latency: null, players: null, error: 'Timeout' });
      }
    }, timeout);

    const magic = Buffer.from('00ffff00fefefefefdfdfdfd12345678', 'hex');
    const packet = Buffer.alloc(33);
    packet.writeUInt8(0x01, 0); // ID_UNCONNECTED_PING
    packet.writeBigInt64BE(BigInt(Date.now()), 1);
    magic.copy(packet, 9);
    packet.writeBigInt64BE(BigInt(2), 25);

    client.on('message', (msg) => {
      if (msg[0] === 0x1c && !resolved) { // ID_UNCONNECTED_PONG
        resolved = true;
        clearTimeout(timer);
        const latency = Math.max(1, Date.now() - start);
        try {
          const strLen = msg.readUInt16BE(33);
          const dataStr = msg.subarray(35, 35 + strLen).toString('utf8');
          const parts = dataStr.split(';');
          const online = parts[4] ? parseInt(parts[4], 10) : 0;
          const max = parts[5] ? parseInt(parts[5], 10) : 0;
          client.close();
          resolve({
            online: true,
            latency,
            players: {
              online: isNaN(online) ? 0 : online,
              max: isNaN(max) ? 0 : max
            },
            version: parts[3] || null
          });
        } catch (e) {
          try { client.close(); } catch (err) { }
          resolve({ online: true, latency, players: null });
        }
      }
    });

    client.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        try { client.close(); } catch (e) { }
        resolve({ online: false, latency: null, players: null, error: err.code || err.message });
      }
    });

    try {
      client.send(packet, 0, packet.length, port, host);
    } catch (e) {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        try { client.close(); } catch (err) { }
        resolve({ online: false, latency: null, players: null, error: e.message });
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
  const isMinecraft = lowerType.includes('minecraft');

  let statusResult = { online: false, latency: null, players: null, version: null };

  if (isMinecraft) {
    const isBedrock = lowerType.includes('bedrock') || port === 19132;
    if (isBedrock) {
      statusResult = await pingMinecraftBedrock(host, port, 1800);
    } else {
      statusResult = await pingMinecraft(host, port, 3000);
    }
  } else {
    // 1. Try TCP socket ping first (fast for TCP games)
    const tcpResult = await pingTcp(host, port, 1000);
    if (tcpResult.online) {
      statusResult = tcpResult;
    } else {
      // 2. Try Steam / Source / UDP query with smart port detection (supports Wreckfest +20, ETS2 27016, Nitrado offsets, etc.)
      const a2sResult = await pingA2sSmart(host, port, 1500);
      if (a2sResult.online) {
        statusResult = a2sResult;
      }
    }
  }

  const finalData = {
    online: !!statusResult.online,
    latency: statusResult.latency,
    players: statusResult.players || null,
    version: statusResult.version || null,
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
