import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './database.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const jsonPath = path.join(__dirname, 'db.json');

async function migrate() {
  console.log('Starte Migration von db.json zu db.sqlite...');
  try {
    const dataStr = await fs.readFile(jsonPath, 'utf-8');
    const data = JSON.parse(dataStr);

    // Users
    if (data.users) {
      for (const [userId, u] of Object.entries(data.users)) {
        await db.updateUser(userId, u);
      }
      console.log(`Migrated ${Object.keys(data.users).length} users.`);
    }

    // Birthdays
    if (data.birthdays) {
      for (const [userId, b] of Object.entries(data.birthdays)) {
        await db.setUserBirthday(userId, b.day, b.month);
      }
      console.log(`Migrated ${Object.keys(data.birthdays).length} birthdays.`);
    }

    // Guilds
    if (data.guilds) {
      for (const [guildId, g] of Object.entries(data.guilds)) {
        if (g.birthdayChannelId) {
          await db.setBirthdayChannel(guildId, g.birthdayChannelId);
        }
      }
      console.log(`Migrated ${Object.keys(data.guilds).length} guilds.`);
    }

    // Announcements
    if (data.announcements) {
      for (const t of (data.announcements.twitch || [])) {
        await db.addTwitchStreamer(t);
      }
      for (const y of (data.announcements.youtube || [])) {
        await db.addYouTubeChannel(y);
      }
      for (const s of (data.announcements.postedStreams || [])) {
        await db.markStreamPosted(s);
      }
      for (const v of (data.announcements.postedVideos || [])) {
        await db.markVideoPosted(v);
      }
      console.log('Migrated announcements.');
    }

    // Dynamic Channels
    if (data.dynamicChannels) {
      for (const [channelId, ownerId] of Object.entries(data.dynamicChannels)) {
        await db.addDynamicChannel(channelId, ownerId);
      }
      console.log(`Migrated ${Object.keys(data.dynamicChannels).length} dynamic channels.`);
    }

    // Tickets
    if (data.tickets) {
      const sqlDb = await db.dbPromise;
      for (const [channelId, t] of Object.entries(data.tickets)) {
        await sqlDb.run('INSERT INTO tickets (channelId, userId, username, createdAt, status) VALUES (?, ?, ?, ?, ?) ON CONFLICT(channelId) DO UPDATE SET userId = excluded.userId, username = excluded.username, createdAt = excluded.createdAt, status = excluded.status', [channelId, t.userId, t.username, t.createdAt, t.status]);
      }
      console.log(`Migrated ${Object.keys(data.tickets).length} tickets.`);
    }

    console.log('Migration erfolgreich abgeschlossen!');
    process.exit(0);
  } catch (err) {
    console.error('Fehler bei der Migration:', err);
    process.exit(1);
  }
}

migrate();
