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
        hasBonus INTEGER DEFAULT 0
      );
      
      CREATE TABLE IF NOT EXISTS birthdays (
        userId TEXT PRIMARY KEY,
        day INTEGER,
        month INTEGER
      );
      
      CREATE TABLE IF NOT EXISTS guilds (
        id TEXT PRIMARY KEY,
        birthdayChannelId TEXT,
        radioChannelId TEXT
      );
      
      CREATE TABLE IF NOT EXISTS announcements_twitch (
        username TEXT PRIMARY KEY
      );
      
      CREATE TABLE IF NOT EXISTS announcements_youtube (
        channelId TEXT PRIMARY KEY
      );
      
      CREATE TABLE IF NOT EXISTS announcements_posted_streams (
        streamId TEXT PRIMARY KEY,
        timestamp INTEGER
      );
      
      CREATE TABLE IF NOT EXISTS announcements_posted_videos (
        videoId TEXT PRIMARY KEY,
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
      await db.exec('ALTER TABLE guilds ADD COLUMN radioChannelId TEXT');
    } catch (err) {}

    return db;
  }

  // --- Birthdays ---
  async setUserBirthday(userId, day, month) {
    const db = await this.dbPromise;
    await db.run('INSERT INTO birthdays (userId, day, month) VALUES (?, ?, ?) ON CONFLICT(userId) DO UPDATE SET day = excluded.day, month = excluded.month', [userId, day, month]);
  }

  async deleteUserBirthday(userId) {
    const db = await this.dbPromise;
    const result = await db.run('DELETE FROM birthdays WHERE userId = ?', [userId]);
    return result.changes > 0;
  }

  async getUserBirthday(userId) {
    const db = await this.dbPromise;
    const row = await db.get('SELECT day, month FROM birthdays WHERE userId = ?', [userId]);
    return row || null;
  }

  async getUsersWithBirthdayToday(day, month) {
    const db = await this.dbPromise;
    const rows = await db.all('SELECT userId FROM birthdays WHERE day = ? AND month = ?', [day, month]);
    return rows.map(r => r.userId);
  }

  async getAllBirthdays() {
    const db = await this.dbPromise;
    const rows = await db.all('SELECT userId, day, month FROM birthdays');
    const result = {};
    for (const r of rows) {
      result[r.userId] = { day: r.day, month: r.month };
    }
    return result;
  }

  // --- Guilds ---
  async setBirthdayChannel(guildId, channelId) {
    const db = await this.dbPromise;
    await db.run('INSERT INTO guilds (id, birthdayChannelId) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET birthdayChannelId = excluded.birthdayChannelId', [guildId, channelId]);
  }

  async getBirthdayChannel(guildId) {
    const db = await this.dbPromise;
    const row = await db.get('SELECT birthdayChannelId FROM guilds WHERE id = ?', [guildId]);
    return row ? row.birthdayChannelId : null;
  }

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
    const rows = await db.all('SELECT id, birthdayChannelId FROM guilds');
    const result = {};
    for (const r of rows) result[r.id] = { birthdayChannelId: r.birthdayChannelId };
    return result;
  }

  // --- Announcements ---
  async getAnnouncementsConfig() {
    const db = await this.dbPromise;
    const twitch = await db.all('SELECT username FROM announcements_twitch');
    const youtube = await db.all('SELECT channelId FROM announcements_youtube');
    const streams = await db.all('SELECT streamId FROM announcements_posted_streams ORDER BY timestamp DESC LIMIT 100');
    const videos = await db.all('SELECT videoId FROM announcements_posted_videos ORDER BY timestamp DESC LIMIT 100');
    
    return {
      twitch: twitch.map(r => r.username),
      youtube: youtube.map(r => r.channelId),
      postedStreams: streams.map(r => r.streamId),
      postedVideos: videos.map(r => r.videoId)
    };
  }

  async addTwitchStreamer(username) {
    const db = await this.dbPromise;
    await db.run('INSERT OR IGNORE INTO announcements_twitch (username) VALUES (?)', [username]);
  }

  async removeTwitchStreamer(username) {
    const db = await this.dbPromise;
    await db.run('DELETE FROM announcements_twitch WHERE username = ?', [username]);
  }

  async addYouTubeChannel(channelId) {
    const db = await this.dbPromise;
    await db.run('INSERT OR IGNORE INTO announcements_youtube (channelId) VALUES (?)', [channelId]);
  }

  async removeYouTubeChannel(channelId) {
    const db = await this.dbPromise;
    await db.run('DELETE FROM announcements_youtube WHERE channelId = ?', [channelId]);
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

  async hasPostedVideo(videoId) {
    const db = await this.dbPromise;
    const row = await db.get('SELECT 1 FROM announcements_posted_videos WHERE videoId = ?', [videoId]);
    return !!row;
  }

  async markVideoPosted(videoId) {
    const db = await this.dbPromise;
    await db.run('INSERT OR IGNORE INTO announcements_posted_videos (videoId, timestamp) VALUES (?, ?)', [videoId, Date.now()]);
  }

  // --- Dynamic Voice Channels ---
  async addDynamicChannel(channelId, ownerId) {
    const db = await this.dbPromise;
    await db.run('INSERT INTO dynamic_channels (channelId, ownerId) VALUES (?, ?) ON CONFLICT(channelId) DO UPDATE SET ownerId = excluded.ownerId', [channelId, ownerId]);
  }

  async removeDynamicChannel(channelId) {
    const db = await this.dbPromise;
    await db.run('DELETE FROM dynamic_channels WHERE channelId = ?', [channelId]);
  }

  async getDynamicChannelOwner(channelId) {
    const db = await this.dbPromise;
    const row = await db.get('SELECT ownerId FROM dynamic_channels WHERE channelId = ?', [channelId]);
    return row?.ownerId || null;
  }

  async isDynamicChannel(channelId) {
    const db = await this.dbPromise;
    const row = await db.get('SELECT 1 FROM dynamic_channels WHERE channelId = ?', [channelId]);
    return !!row;
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
    let user = await db.get('SELECT xp, level, lastMessageTimestamp, dailyVoicePoints, dailyVoiceReset, hasBonus FROM users WHERE id = ?', [userId]);
    if (!user) {
      user = { xp: 0, level: 0, lastMessageTimestamp: 0, dailyVoicePoints: 0, dailyVoiceReset: 0, hasBonus: 0 };
      await db.run('INSERT INTO users (id, xp, level, lastMessageTimestamp, dailyVoicePoints, dailyVoiceReset, hasBonus) VALUES (?, ?, ?, ?, ?, ?, ?)', [userId, 0, 0, 0, 0, 0, 0]);
    }
    return user;
  }

  async updateUser(userId, userData) {
    const db = await this.dbPromise;
    await db.run(`
      INSERT INTO users (id, xp, level, lastMessageTimestamp, dailyVoicePoints, dailyVoiceReset, hasBonus)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        xp = excluded.xp,
        level = excluded.level,
        lastMessageTimestamp = excluded.lastMessageTimestamp,
        dailyVoicePoints = excluded.dailyVoicePoints,
        dailyVoiceReset = excluded.dailyVoiceReset,
        hasBonus = excluded.hasBonus
    `, [userId, userData.xp, userData.level, userData.lastMessageTimestamp, userData.dailyVoicePoints, userData.dailyVoiceReset, userData.hasBonus || 0]);
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
        hasBonus: r.hasBonus
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
        `INSERT INTO users (id, xp, level, lastMessageTimestamp, dailyVocieMinutes) 
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
}

export const db = new Database();
