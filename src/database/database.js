import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, 'db.sqlite');

class Database {
  constructor() {
    this.dbPromise = this.init();
  }

  async init() {
    const db = await open({
      filename: dbPath,
      driver: sqlite3.Database
    });

    // Create tables
    await db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        xp INTEGER DEFAULT 0,
        level INTEGER DEFAULT 1,
        lastMessageTimestamp INTEGER DEFAULT 0,
        dailyVoicePoints INTEGER DEFAULT 0,
        dailyVoiceReset INTEGER DEFAULT 0,
        hasBonus INTEGER DEFAULT 0,
        lastWeeklyTimestamp INTEGER DEFAULT 0,
        lastPenaltyTimestamp INTEGER DEFAULT 0
      );
      
      CREATE TABLE IF NOT EXISTS guilds (
        id TEXT PRIMARY KEY,
        radioChannelId TEXT
      );
      
      CREATE TABLE IF NOT EXISTS announcements_twitch (
        username TEXT PRIMARY KEY,
        discordUserId TEXT
      );
      
      CREATE TABLE IF NOT EXISTS announcements_posted_streams (
        streamId TEXT PRIMARY KEY,
        timestamp INTEGER
      );
      
      CREATE TABLE IF NOT EXISTS redeem_codes (
        code TEXT PRIMARY KEY,
        xp INTEGER,
        active INTEGER DEFAULT 0,
        show_in_stream INTEGER DEFAULT 0,
        createdAt INTEGER
      );

      CREATE TABLE IF NOT EXISTS redeem_history (
        userId TEXT,
        code TEXT,
        redeemedAt INTEGER,
        PRIMARY KEY (userId, code)
      );

      CREATE TABLE IF NOT EXISTS dynamic_channels (
        channelId TEXT PRIMARY KEY,
        ownerId TEXT
      );
      
      CREATE TABLE IF NOT EXISTS support_tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channelId TEXT UNIQUE,
        userId TEXT,
        status TEXT,
        claimedBy TEXT,
        createdAt INTEGER,
        closedAt INTEGER
      );
      
      CREATE TABLE IF NOT EXISTS giveaways (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channelId TEXT,
        messageId TEXT,
        title TEXT,
        description TEXT,
        banner TEXT,
        hostedBy TEXT,
        endsAt INTEGER,
        winnerCount INTEGER DEFAULT 1,
        minXp INTEGER DEFAULT 0,
        status TEXT DEFAULT 'active'
      );
      
      CREATE TABLE IF NOT EXISTS giveaway_entries (
        giveawayId INTEGER,
        userId TEXT,
        PRIMARY KEY (giveawayId, userId)
      );
      
      CREATE TABLE IF NOT EXISTS tickets (
        channelId TEXT PRIMARY KEY,
        userId TEXT,
        username TEXT,
        createdAt INTEGER,
        status TEXT
      );

      CREATE TABLE IF NOT EXISTS partners (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        link TEXT NOT NULL,
        createdAt INTEGER
      );

      CREATE TABLE IF NOT EXISTS games (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE,
        platform TEXT,
        addedBy TEXT,
        createdAt INTEGER
      );

      CREATE TABLE IF NOT EXISTS game_suggestions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        platform TEXT,
        userId TEXT,
        status TEXT DEFAULT 'pending',
        createdAt INTEGER
      );

      CREATE TABLE IF NOT EXISTS user_lobby_alerts (
        userId TEXT,
        gameId INTEGER,
        noPing INTEGER DEFAULT 0,
        createdAt INTEGER,
        PRIMARY KEY (userId, gameId)
      );

      CREATE TABLE IF NOT EXISTS lobby_codes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        messageId TEXT UNIQUE,
        channelId TEXT,
        threadId TEXT,
        userId TEXT,
        gameName TEXT,
        code TEXT,
        note TEXT,
        createdAt INTEGER,
        expiresAt INTEGER
      );

      CREATE TABLE IF NOT EXISTS lfg_threads (
        threadId TEXT PRIMARY KEY,
        channelId TEXT,
        creatorId TEXT,
        gameName TEXT,
        createdAt INTEGER,
        expiresAt INTEGER,
        status TEXT DEFAULT 'active'
      );

      CREATE TABLE IF NOT EXISTS lfg_cooldowns (
        userId TEXT PRIMARY KEY,
        lastUsed INTEGER
      );

      CREATE TABLE IF NOT EXISTS lobby_config (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `);

    try {
      await db.exec('ALTER TABLE users ADD COLUMN hasBonus INTEGER DEFAULT 0');
    } catch (err) {
      // Column might already exist, ignore error
    }

    try {
      await db.exec('ALTER TABLE users ADD COLUMN lastWeeklyTimestamp INTEGER DEFAULT 0');
    } catch (err) {
      // Column might already exist
    }

    try {
      await db.exec('ALTER TABLE users ADD COLUMN lastPenaltyTimestamp INTEGER DEFAULT 0');
    } catch (err) {
      // Column might already exist
    }

    try {
      await db.exec('ALTER TABLE guilds ADD COLUMN radioChannelId TEXT');
    } catch (err) {}

    try {
      await db.exec('ALTER TABLE announcements_twitch ADD COLUMN discordUserId TEXT');
    } catch (err) {}

    try {
      const partnerCount = await db.get('SELECT COUNT(*) as count FROM partners');
      if (partnerCount && partnerCount.count === 0) {
        await db.run(
          `INSERT INTO partners (name, description, link, createdAt) VALUES (?, ?, ?, ?)`,
          [
            'Frogly Studios',
            'Frogly Studios ist ein innovatives Game- und Softwarestudio, welches durch seinen erstklassigen Support die Entwicklung und den Betrieb dieses Bots (the grid.) maßgeblich ermöglicht.',
            'https://frogly.fun',
            Date.now()
          ]
        );
      }
    } catch (err) {}

    return db;
  }

  // --- Guilds ---
  async setRadioChannel(guildId, channelId) {
    const db = await this.dbPromise;
    if (channelId === null) {
      // Disconnect/Remove radio channel
      await db.run('INSERT INTO guilds (id, radioChannelId) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET radioChannelId = NULL', [guildId, null]);
    } else {
      await db.run('INSERT INTO guilds (id, radioChannelId) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET radioChannelId = excluded.radioChannelId', [guildId, channelId]);
    }
  }

  async getRadioChannel(guildId) {
    const db = await this.dbPromise;
    const row = await db.get('SELECT radioChannelId FROM guilds WHERE id = ?', [guildId]);
    return row ? row.radioChannelId : null;
  }

  async getAllGuildConfigs() {
    const db = await this.dbPromise;
    const rows = await db.all('SELECT id FROM guilds');
    const result = {};
    for (const r of rows) result[r.id] = {};
    return result;
  }

  // --- Announcements ---
  async getAnnouncementsConfig() {
    const db = await this.dbPromise;
    const twitch = await db.all('SELECT username, discordUserId FROM announcements_twitch');
    const streams = await db.all('SELECT streamId FROM announcements_posted_streams ORDER BY timestamp DESC LIMIT 100');
    
    return {
      twitch: twitch,
      postedStreams: streams.map(r => r.streamId)
    };
  }

  async addTwitchStreamer(username, discordUserId) {
    const db = await this.dbPromise;
    await db.run('INSERT OR REPLACE INTO announcements_twitch (username, discordUserId) VALUES (?, ?)', [username, discordUserId]);
  }

  async removeTwitchStreamer(username) {
    const db = await this.dbPromise;
    await db.run('DELETE FROM announcements_twitch WHERE username = ?', [username]);
  }

  async hasPostedStream(streamId) {
    const db = await this.dbPromise;
    const row = await db.get('SELECT 1 FROM announcements_posted_streams WHERE streamId = ?', [streamId]);
    return !!row;
  }

  async markStreamPosted(streamId) {
    const db = await this.dbPromise;
    await db.run('INSERT OR IGNORE INTO announcements_posted_streams (streamId, timestamp) VALUES (?, ?)', [streamId, Date.now()]);
  }

  // --- Dynamic Voice Channels ---
  async addDynamicChannel(channelId, ownerId) {
    const db = await this.dbPromise;
    await db.run('INSERT OR REPLACE INTO dynamic_channels (channelId, ownerId) VALUES (?, ?)', [channelId, ownerId]);
  }

  async removeDynamicChannel(channelId) {
    const db = await this.dbPromise;
    await db.run('DELETE FROM dynamic_channels WHERE channelId = ?', [channelId]);
  }

  async getDynamicChannelOwner(channelId) {
    const db = await this.dbPromise;
    const result = await db.get('SELECT ownerId FROM dynamic_channels WHERE channelId = ?', [channelId]);
    return result ? result.ownerId : null;
  }

  async isDynamicChannel(channelId) {
    const db = await this.dbPromise;
    const result = await db.get('SELECT 1 FROM dynamic_channels WHERE channelId = ?', [channelId]);
    return !!result;
  }

  // --- Giveaways ---
  async createGiveaway(data) {
    const db = await this.dbPromise;
    const result = await db.run(`
      INSERT INTO giveaways (channelId, messageId, title, description, banner, hostedBy, endsAt, winnerCount, minXp, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      data.channelId,
      data.messageId,
      data.title,
      data.description,
      data.banner || '',
      data.hostedBy || '',
      data.endsAt,
      data.winnerCount || 1,
      data.minXp || 0,
      'active'
    ]);
    return result.lastID;
  }

  async getActiveGiveaways() {
    const db = await this.dbPromise;
    return await db.all('SELECT * FROM giveaways WHERE status = "active"');
  }

  async getAllGiveaways() {
    const db = await this.dbPromise;
    return await db.all('SELECT * FROM giveaways ORDER BY endsAt DESC');
  }

  async getGiveaway(id) {
    const db = await this.dbPromise;
    return await db.get('SELECT * FROM giveaways WHERE id = ?', [id]);
  }

  async updateGiveawayMessageId(id, messageId) {
    const db = await this.dbPromise;
    await db.run('UPDATE giveaways SET messageId = ? WHERE id = ?', [messageId, id]);
  }

  async endGiveaway(id) {
    const db = await this.dbPromise;
    await db.run('UPDATE giveaways SET status = "ended" WHERE id = ?', [id]);
  }

  async addGiveawayEntry(giveawayId, userId) {
    const db = await this.dbPromise;
    await db.run('INSERT OR IGNORE INTO giveaway_entries (giveawayId, userId) VALUES (?, ?)', [giveawayId, userId]);
  }

  async getGiveawayEntries(giveawayId) {
    const db = await this.dbPromise;
    const entries = await db.all('SELECT userId FROM giveaway_entries WHERE giveawayId = ?', [giveawayId]);
    return entries.map(e => e.userId);
  }

  async hasUserEnteredGiveaway(giveawayId, userId) {
    const db = await this.dbPromise;
    const result = await db.get('SELECT 1 FROM giveaway_entries WHERE giveawayId = ? AND userId = ?', [giveawayId, userId]);
    return !!result;
  }

  // --- Tickets ---
  async createTicket(channelId, userId, username) {
    const db = await this.dbPromise;
    await db.run('INSERT INTO tickets (channelId, userId, username, createdAt, status) VALUES (?, ?, ?, ?, ?) ON CONFLICT(channelId) DO UPDATE SET userId = excluded.userId, username = excluded.username, createdAt = excluded.createdAt, status = excluded.status', [channelId, userId, username, Date.now(), 'open']);
  }

  async closeTicket(channelId) {
    const db = await this.dbPromise;
    await db.run('UPDATE tickets SET status = ? WHERE channelId = ?', ['closed', channelId]);
  }

  async reopenTicket(channelId) {
    const db = await this.dbPromise;
    await db.run('UPDATE tickets SET status = ? WHERE channelId = ?', ['open', channelId]);
  }

  async deleteTicket(channelId) {
    const db = await this.dbPromise;
    await db.run('DELETE FROM tickets WHERE channelId = ?', [channelId]);
  }

  async getTickets() {
    const db = await this.dbPromise;
    const rows = await db.all('SELECT * FROM tickets');
    const result = {};
    for (const r of rows) {
      result[r.channelId] = {
        userId: r.userId,
        username: r.username,
        createdAt: r.createdAt,
        status: r.status
      };
    }
    return result;
  }

  // --- Leveling & XP ---
  async getUser(userId) {
    const db = await this.dbPromise;
    let user = await db.get('SELECT xp, level, lastMessageTimestamp, dailyVoicePoints, dailyVoiceReset, hasBonus, lastWeeklyTimestamp, lastPenaltyTimestamp FROM users WHERE id = ?', [userId]);
    if (!user) {
      user = { xp: 0, level: 0, lastMessageTimestamp: 0, dailyVoicePoints: 0, dailyVoiceReset: 0, hasBonus: 0, lastWeeklyTimestamp: 0, lastPenaltyTimestamp: 0 };
      await db.run('INSERT INTO users (id, xp, level, lastMessageTimestamp, dailyVoicePoints, dailyVoiceReset, hasBonus, lastWeeklyTimestamp, lastPenaltyTimestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [userId, 0, 0, 0, 0, 0, 0, 0, 0]);
    }
    return user;
  }

  async updateUser(userId, userData) {
    const db = await this.dbPromise;
    await db.run(`
      INSERT INTO users (id, xp, level, lastMessageTimestamp, dailyVoicePoints, dailyVoiceReset, hasBonus, lastWeeklyTimestamp, lastPenaltyTimestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        xp = excluded.xp,
        level = excluded.level,
        lastMessageTimestamp = excluded.lastMessageTimestamp,
        dailyVoicePoints = excluded.dailyVoicePoints,
        dailyVoiceReset = excluded.dailyVoiceReset,
        hasBonus = excluded.hasBonus,
        lastWeeklyTimestamp = excluded.lastWeeklyTimestamp,
        lastPenaltyTimestamp = excluded.lastPenaltyTimestamp
    `, [userId, userData.xp, userData.level, userData.lastMessageTimestamp, userData.dailyVoicePoints, userData.dailyVoiceReset, userData.hasBonus || 0, userData.lastWeeklyTimestamp || 0, userData.lastPenaltyTimestamp || 0]);
  }

  async deleteUser(userId) {
    const db = await this.dbPromise;
    await db.run('DELETE FROM users WHERE id = ?', [userId]);
  }

  async getAllUsers() {
    const db = await this.dbPromise;
    const rows = await db.all('SELECT * FROM users');
    const result = {};
    for (const r of rows) {
      result[r.id] = {
        xp: r.xp,
        level: r.level,
        lastMessageTimestamp: r.lastMessageTimestamp,
        dailyVoicePoints: r.dailyVoicePoints,
        dailyVoiceReset: r.dailyVoiceReset,
        hasBonus: r.hasBonus,
        lastWeeklyTimestamp: r.lastWeeklyTimestamp,
        lastPenaltyTimestamp: r.lastPenaltyTimestamp
      };
    }
    return result;
  }
  // ==========================================
  // REDEEM CODES (Creator Program)
  // ==========================================

  async createRedeemCode(code, xp) {
    const db = await this.dbPromise;
    const result = await db.run(
      `INSERT INTO redeem_codes (code, xp, active, show_in_stream, createdAt) VALUES (?, ?, 0, 0, ?)`,
      [code, xp, Date.now()]
    );
    return result.lastID;
  }

  async getAllRedeemCodes() {
    const db = await this.dbPromise;
    const rows = await db.all(`SELECT * FROM redeem_codes ORDER BY createdAt DESC`);
    return rows || [];
  }

  async getRedeemCode(code) {
    const db = await this.dbPromise;
    const row = await db.get(`SELECT * FROM redeem_codes WHERE code = ?`, [code]);
    return row;
  }

  async updateRedeemCode(code, active, show_in_stream) {
    const db = await this.dbPromise;
    await db.run(
      `UPDATE redeem_codes SET active = ?, show_in_stream = ? WHERE code = ?`,
      [active, show_in_stream, code]
    );
  }

  async deleteRedeemCode(code) {
    const db = await this.dbPromise;
    await db.run(`DELETE FROM redeem_codes WHERE code = ?`, [code]);
  }

  async hasUserRedeemedCode(userId, code) {
    const db = await this.dbPromise;
    const row = await db.get(`SELECT * FROM redeem_history WHERE userId = ? AND code = ?`, [userId, code]);
    return !!row;
  }

  async redeemCodeForUser(userId, code, xp) {
    const db = await this.dbPromise;
    await db.run('BEGIN TRANSACTION');
    try {
      await db.run(`INSERT INTO redeem_history (userId, code, redeemedAt) VALUES (?, ?, ?)`, [userId, code, Date.now()]);
      await db.run(
        `INSERT INTO users (id, xp, level, lastMessageTimestamp, dailyVoicePoints) 
         VALUES (?, ?, 1, 0, 0)
         ON CONFLICT(id) DO UPDATE SET xp = xp + ?`,
        [userId, xp, xp]
      );
      await db.run('COMMIT');
    } catch (err) {
      await db.run('ROLLBACK');
      throw err;
    }
  }
  // --- Giveaways ---
  async createGiveaway(data) {
    const db = await this.dbPromise;
    const result = await db.run(`
      INSERT INTO giveaways (channelId, messageId, title, description, banner, hostedBy, endsAt, winnerCount, minXp, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      data.channelId,
      data.messageId,
      data.title,
      data.description,
      data.banner || '',
      data.hostedBy || '',
      data.endsAt,
      data.winnerCount || 1,
      data.minXp || 0,
      'active'
    ]);
    return result.lastID;
  }

  async getActiveGiveaways() {
    const db = await this.dbPromise;
    return await db.all('SELECT * FROM giveaways WHERE status = "active"');
  }

  async getAllGiveaways() {
    const db = await this.dbPromise;
    return await db.all('SELECT * FROM giveaways ORDER BY endsAt DESC');
  }

  async getGiveaway(id) {
    const db = await this.dbPromise;
    return await db.get('SELECT * FROM giveaways WHERE id = ?', [id]);
  }

  async updateGiveawayMessageId(id, messageId) {
    const db = await this.dbPromise;
    await db.run('UPDATE giveaways SET messageId = ? WHERE id = ?', [messageId, id]);
  }

  async endGiveaway(id) {
    const db = await this.dbPromise;
    await db.run('UPDATE giveaways SET status = "ended" WHERE id = ?', [id]);
  }

  async addGiveawayEntry(giveawayId, userId) {
    const db = await this.dbPromise;
    await db.run('INSERT OR IGNORE INTO giveaway_entries (giveawayId, userId) VALUES (?, ?)', [giveawayId, userId]);
  }

  async getGiveawayEntries(giveawayId) {
    const db = await this.dbPromise;
    const entries = await db.all('SELECT userId FROM giveaway_entries WHERE giveawayId = ?', [giveawayId]);
    return entries.map(e => e.userId);
  }

  async hasUserEnteredGiveaway(giveawayId, userId) {
    const db = await this.dbPromise;
    const result = await db.get('SELECT 1 FROM giveaway_entries WHERE giveawayId = ? AND userId = ?', [giveawayId, userId]);
    return !!result;
  }

  async deleteGiveaway(id) {
    const db = await this.dbPromise;
    await db.run('DELETE FROM giveaways WHERE id = ?', [id]);
    await db.run('DELETE FROM giveaway_entries WHERE giveawayId = ?', [id]);
  }

  // --- Partners ---
  async getPartners() {
    const db = await this.dbPromise;
    return await db.all('SELECT * FROM partners ORDER BY id ASC');
  }

  async getPartner(id) {
    const db = await this.dbPromise;
    return await db.get('SELECT * FROM partners WHERE id = ?', [id]);
  }

  async addPartner(name, description, link) {
    const db = await this.dbPromise;
    const result = await db.run(
      'INSERT INTO partners (name, description, link, createdAt) VALUES (?, ?, ?, ?)',
      [name, description, link, Date.now()]
    );
    return result.lastID;
  }

  async updatePartner(id, name, description, link) {
    const db = await this.dbPromise;
    await db.run(
      'UPDATE partners SET name = ?, description = ?, link = ? WHERE id = ?',
      [name, description, link, id]
    );
  }

  async deletePartner(id) {
    const db = await this.dbPromise;
    await db.run('DELETE FROM partners WHERE id = ?', [id]);
  }

  // --- Games & Lobbys ---
  async getAllGames() {
    const db = await this.dbPromise;
    return await db.all('SELECT * FROM games ORDER BY name ASC');
  }

  async getGame(id) {
    const db = await this.dbPromise;
    return await db.get('SELECT * FROM games WHERE id = ?', [id]);
  }

  async getGameByName(name) {
    const db = await this.dbPromise;
    return await db.get('SELECT * FROM games WHERE LOWER(name) = LOWER(?)', [name]);
  }

  async addGame(name, platform, addedBy) {
    const db = await this.dbPromise;
    const result = await db.run(
      'INSERT INTO games (name, platform, addedBy, createdAt) VALUES (?, ?, ?, ?)',
      [name, platform || 'Allgemein', addedBy || 'System', Date.now()]
    );
    return result.lastID;
  }

  async updateGame(id, name, platform) {
    const db = await this.dbPromise;
    await db.run('UPDATE games SET name = ?, platform = ? WHERE id = ?', [name, platform, id]);
  }

  async deleteGame(id) {
    const db = await this.dbPromise;
    await db.run('DELETE FROM games WHERE id = ?', [id]);
    await db.run('DELETE FROM user_lobby_alerts WHERE gameId = ?', [id]);
  }

  // --- Game Suggestions ---
  async getAllSuggestions() {
    const db = await this.dbPromise;
    return await db.all('SELECT * FROM game_suggestions ORDER BY createdAt DESC');
  }

  async getPendingSuggestions() {
    const db = await this.dbPromise;
    return await db.all('SELECT * FROM game_suggestions WHERE status = "pending" ORDER BY createdAt DESC');
  }

  async addSuggestion(name, platform, userId) {
    const db = await this.dbPromise;
    const result = await db.run(
      'INSERT INTO game_suggestions (name, platform, userId, status, createdAt) VALUES (?, ?, ?, "pending", ?)',
      [name, platform || 'Allgemein', userId, Date.now()]
    );
    return result.lastID;
  }

  async updateSuggestionStatus(id, status) {
    const db = await this.dbPromise;
    await db.run('UPDATE game_suggestions SET status = ? WHERE id = ?', [status, id]);
  }

  async deleteSuggestion(id) {
    const db = await this.dbPromise;
    await db.run('DELETE FROM game_suggestions WHERE id = ?', [id]);
  }

  // --- User Lobby Alerts ---
  async getUserAlerts(userId) {
    const db = await this.dbPromise;
    return await db.all(
      `SELECT ula.gameId, ula.noPing, g.name as gameName, g.platform 
       FROM user_lobby_alerts ula 
       JOIN games g ON ula.gameId = g.id 
       WHERE ula.userId = ? 
       ORDER BY g.name ASC`,
      [userId]
    );
  }

  async hasUserAlert(userId, gameId) {
    const db = await this.dbPromise;
    const row = await db.get('SELECT 1 FROM user_lobby_alerts WHERE userId = ? AND gameId = ?', [userId, gameId]);
    return !!row;
  }

  async addUserAlert(userId, gameId, noPing = 0) {
    const db = await this.dbPromise;
    await db.run(
      'INSERT OR REPLACE INTO user_lobby_alerts (userId, gameId, noPing, createdAt) VALUES (?, ?, ?, ?)',
      [userId, gameId, noPing ? 1 : 0, Date.now()]
    );
  }

  async removeUserAlert(userId, gameId) {
    const db = await this.dbPromise;
    await db.run('DELETE FROM user_lobby_alerts WHERE userId = ? AND gameId = ?', [userId, gameId]);
  }

  async setUserAlertNoPing(userId, noPing) {
    const db = await this.dbPromise;
    await db.run('UPDATE user_lobby_alerts SET noPing = ? WHERE userId = ?', [noPing ? 1 : 0, userId]);
  }

  async getUserGlobalNoPing(userId) {
    const db = await this.dbPromise;
    const row = await db.get('SELECT noPing FROM user_lobby_alerts WHERE userId = ? LIMIT 1', [userId]);
    return row ? row.noPing === 1 : false;
  }

  async getUsersForGame(gameId) {
    const db = await this.dbPromise;
    return await db.all('SELECT userId, noPing FROM user_lobby_alerts WHERE gameId = ?', [gameId]);
  }

  // --- Lobby Codes ---
  async addLobbyCode(messageId, channelId, threadId, userId, gameName, code, note, expiresAt) {
    const db = await this.dbPromise;
    await db.run(
      `INSERT INTO lobby_codes (messageId, channelId, threadId, userId, gameName, code, note, createdAt, expiresAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [messageId, channelId, threadId, userId, gameName, code, note || '', Date.now(), expiresAt]
    );
  }

  async getExpiredLobbyCodes(now = Date.now()) {
    const db = await this.dbPromise;
    return await db.all('SELECT * FROM lobby_codes WHERE expiresAt <= ?', [now]);
  }

  async deleteLobbyCode(messageId) {
    const db = await this.dbPromise;
    await db.run('DELETE FROM lobby_codes WHERE messageId = ?', [messageId]);
  }

  // --- LFG Threads ---
  async addLfgThread(threadId, channelId, creatorId, gameName, expiresAt) {
    const db = await this.dbPromise;
    await db.run(
      `INSERT INTO lfg_threads (threadId, channelId, creatorId, gameName, createdAt, expiresAt, status)
       VALUES (?, ?, ?, ?, ?, ?, 'active')`,
      [threadId, channelId, creatorId, gameName, Date.now(), expiresAt]
    );
  }

  async getLfgThread(threadId) {
    const db = await this.dbPromise;
    return await db.get('SELECT * FROM lfg_threads WHERE threadId = ?', [threadId]);
  }

  async closeLfgThread(threadId) {
    const db = await this.dbPromise;
    await db.run('UPDATE lfg_threads SET status = "closed" WHERE threadId = ?', [threadId]);
  }

  async getExpiredLfgThreads(now = Date.now()) {
    const db = await this.dbPromise;
    return await db.all('SELECT * FROM lfg_threads WHERE expiresAt <= ? AND status = "active"', [now]);
  }

  // --- LFG Cooldowns ---
  async getLfgCooldown(userId) {
    const db = await this.dbPromise;
    const row = await db.get('SELECT lastUsed FROM lfg_cooldowns WHERE userId = ?', [userId]);
    return row ? row.lastUsed : 0;
  }

  async setLfgCooldown(userId, timestamp = Date.now()) {
    const db = await this.dbPromise;
    await db.run(
      'INSERT OR REPLACE INTO lfg_cooldowns (userId, lastUsed) VALUES (?, ?)',
      [userId, timestamp]
    );
  }

  // --- Lobby Config ---
  async getLobbyConfig(key) {
    const db = await this.dbPromise;
    const row = await db.get('SELECT value FROM lobby_config WHERE key = ?', [key]);
    return row ? row.value : null;
  }

  async setLobbyConfig(key, value) {
    const db = await this.dbPromise;
    await db.run('INSERT OR REPLACE INTO lobby_config (key, value) VALUES (?, ?)', [key, value]);
  }
}

export const db = new Database();
