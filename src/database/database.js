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
      return { birthdays: {}, guilds: {} };
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
}

export const db = new Database();
