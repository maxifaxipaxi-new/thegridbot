import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, 'db.json');

class Database {
  async _read() {
    try {
      const data = await fs.readFile(dbPath, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      // Falls die Datei nicht existiert oder fehlerhaft ist, Standardstruktur zurückgeben
      return { birthdays: {}, guilds: {}, dynamicChannels: {} };
    }
  }

  async _write(data) {
    await fs.writeFile(dbPath, JSON.stringify(data, null, 2), 'utf-8');
  }

  async setUserBirthday(userId, day, month) {
    const data = await this._read();
    data.birthdays[userId] = { day, month };
    await this._write(data);
  }

  async deleteUserBirthday(userId) {
    const data = await this._read();
    if (data.birthdays[userId]) {
      delete data.birthdays[userId];
      await this._write(data);
      return true;
    }
    return false;
  }

  async getUserBirthday(userId) {
    const data = await this._read();
    return data.birthdays[userId] || null;
  }

  async getUsersWithBirthdayToday(day, month) {
    const data = await this._read();
    const users = [];
    for (const [userId, bday] of Object.entries(data.birthdays)) {
      if (bday.day === day && bday.month === month) {
        users.push(userId);
      }
    }
    return users;
  }

  async setBirthdayChannel(guildId, channelId) {
    const data = await this._read();
    if (!data.guilds[guildId]) {
      data.guilds[guildId] = {};
    }
    data.guilds[guildId].birthdayChannelId = channelId;
    await this._write(data);
  }

  async getBirthdayChannel(guildId) {
    const data = await this._read();
    return data.guilds[guildId]?.birthdayChannelId || null;
  }

  async getAllGuildConfigs() {
    const data = await this._read();
    return data.guilds;
  }

  // ANNOUNCEMENTS
  async getAnnouncementsConfig() {
    const data = await this._read();
    if (!data.announcements) {
      data.announcements = { twitch: [], youtube: [], postedStreams: [], postedVideos: [] };
      await this._write(data);
    }
    return data.announcements;
  }

  async addTwitchStreamer(username) {
    const data = await this._read();
    if (!data.announcements) data.announcements = { twitch: [], youtube: [], postedStreams: [], postedVideos: [] };
    if (!data.announcements.twitch.includes(username)) {
      data.announcements.twitch.push(username);
      await this._write(data);
    }
  }

  async removeTwitchStreamer(username) {
    const data = await this._read();
    if (!data.announcements) return;
    data.announcements.twitch = data.announcements.twitch.filter(u => u !== username);
    await this._write(data);
  }

  async addYouTubeChannel(channelId) {
    const data = await this._read();
    if (!data.announcements) data.announcements = { twitch: [], youtube: [], postedStreams: [], postedVideos: [] };
    if (!data.announcements.youtube.includes(channelId)) {
      data.announcements.youtube.push(channelId);
      await this._write(data);
    }
  }

  async removeYouTubeChannel(channelId) {
    const data = await this._read();
    if (!data.announcements) return;
    data.announcements.youtube = data.announcements.youtube.filter(c => c !== channelId);
    await this._write(data);
  }

  async hasPostedStream(streamId) {
    const config = await this.getAnnouncementsConfig();
    return config.postedStreams.includes(streamId);
  }

  async markStreamPosted(streamId) {
    const data = await this._read();
    if (!data.announcements) data.announcements = { twitch: [], youtube: [], postedStreams: [], postedVideos: [] };
    data.announcements.postedStreams.push(streamId);
    // Keep only last 100 to prevent unbounded growth
    if (data.announcements.postedStreams.length > 100) {
      data.announcements.postedStreams.shift();
    }
    await this._write(data);
  }

  async hasPostedVideo(videoId) {
    const config = await this.getAnnouncementsConfig();
    return config.postedVideos.includes(videoId);
  }

  async markVideoPosted(videoId) {
    const data = await this._read();
    if (!data.announcements) data.announcements = { twitch: [], youtube: [], postedStreams: [], postedVideos: [] };
    data.announcements.postedVideos.push(videoId);
    if (data.announcements.postedVideos.length > 100) {
      data.announcements.postedVideos.shift();
    }
    await this._write(data);
  }

  // DYNAMIC VOICE CHANNELS
  async addDynamicChannel(channelId, ownerId) {
    const data = await this._read();
    if (!data.dynamicChannels) data.dynamicChannels = {};
    data.dynamicChannels[channelId] = ownerId;
    await this._write(data);
  }

  async removeDynamicChannel(channelId) {
    const data = await this._read();
    if (!data.dynamicChannels) return;
    if (data.dynamicChannels[channelId]) {
      delete data.dynamicChannels[channelId];
      await this._write(data);
    }
  }

  async getDynamicChannelOwner(channelId) {
    const data = await this._read();
    if (!data.dynamicChannels) return null;
    return data.dynamicChannels[channelId] || null;
  }

  async isDynamicChannel(channelId) {
    const data = await this._read();
    if (!data.dynamicChannels) return false;
    return !!data.dynamicChannels[channelId];
  }
}

export const db = new Database();
