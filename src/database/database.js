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
        lastWeeklyTimestamp INTEGER DEFAULT 0
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
      await db.exec('ALTER TABLE guilds ADD COLUMN radioChannelId TEXT');
    } catch (err) {}

    try {
      await db.exec('ALTER TABLE announcements_twitch ADD COLUMN discordUserId TEXT');
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
    let user = await db.get('SELECT xp, level, lastMessageTimestamp, dailyVoicePoints, dailyVoiceReset, hasBonus, lastWeeklyTimestamp FROM users WHERE id = ?', [userId]);
    if (!user) {
      user = { xp: 0, level: 0, lastMessageTimestamp: 0, dailyVoicePoints: 0, dailyVoiceReset: 0, hasBonus: 0, lastWeeklyTimestamp: 0 };
      await db.run('INSERT INTO users (id, xp, level, lastMessageTimestamp, dailyVoicePoints, dailyVoiceReset, hasBonus, lastWeeklyTimestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [userId, 0, 0, 0, 0, 0, 0, 0]);
    }
    return user;
  }

  async updateUser(userId, userData) {
    const db = await this.dbPromise;
    await db.run(`
      INSERT INTO users (id, xp, level, lastMessageTimestamp, dailyVoicePoints, dailyVoiceReset, hasBonus, lastWeeklyTimestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        xp = excluded.xp,
        level = excluded.level,
        lastMessageTimestamp = excluded.lastMessageTimestamp,
        dailyVoicePoints = excluded.dailyVoicePoints,
        dailyVoiceReset = excluded.dailyVoiceReset,
        hasBonus = excluded.hasBonus,
        lastWeeklyTimestamp = excluded.lastWeeklyTimestamp
    `, [userId, userData.xp, userData.level, userData.lastMessageTimestamp, userData.dailyVoicePoints, userData.dailyVoiceReset, userData.hasBonus || 0, userData.lastWeeklyTimestamp || 0]);
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
        lastWeeklyTimestamp: r.lastWeeklyTimestamp
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
}

export const db = new Database();
