import cron from 'node-cron';
import axios from 'axios';
import Parser from 'rss-parser';
import { EmbedBuilder } from 'discord.js';
import { db } from './database/database.js';

const parser = new Parser();
const ANNOUNCEMENT_CHANNEL_ID = '1338098698042736711';

let isAnnouncementsStarted = false;
let twitchAccessToken = null;
let twitchTokenExpiresAt = 0;

async function getTwitchToken() {
  const clientId = process.env.TWITCH_CLIENT_ID;
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;

  if (!clientId || !clientSecret || clientId.includes('dein_twitch')) return null;

  if (twitchAccessToken && Date.now() < twitchTokenExpiresAt) {
    return twitchAccessToken;
  }

  try {
    const res = await axios.post(`https://id.twitch.tv/oauth2/token?client_id=${clientId}&client_secret=${clientSecret}&grant_type=client_credentials`);
    twitchAccessToken = res.data.access_token;
    twitchTokenExpiresAt = Date.now() + (res.data.expires_in * 1000) - 60000; // 1 min buffer
    return twitchAccessToken;
  } catch (err) {
    console.error('Fehler beim Abrufen des Twitch Tokens:', err.response?.data || err.message);
    return null;
  }
}

async function checkTwitch(client) {
  const config = await db.getAnnouncementsConfig();
  if (!config.twitch || config.twitch.length === 0) return;

  const token = await getTwitchToken();
  if (!token) {
    console.log('Überspringe Twitch Check: Keine validen API Keys in .env gefunden.');
    return;
  }

  const clientId = process.env.TWITCH_CLIENT_ID;

  for (const username of config.twitch) {
    try {
      const res = await axios.get(`https://api.twitch.tv/helix/streams?user_login=${username}`, {
        headers: {
          'Client-ID': clientId,
          'Authorization': `Bearer ${token}`
        }
      });

      const data = res.data.data;
      if (data && data.length > 0) {
        const stream = data[0];
        const streamId = stream.id;

        const hasPosted = await db.hasPostedStream(streamId);
        if (!hasPosted) {
          await postTwitchAnnouncement(client, stream);
          await db.markStreamPosted(streamId);
        }
      }
    } catch (err) {
      console.error(`Fehler beim Prüfen des Twitch-Streams von ${username}:`, err.response?.data || err.message);
    }
  }
}

async function postTwitchAnnouncement(client, stream) {
  try {
    const channel = await client.channels.fetch(ANNOUNCEMENT_CHANNEL_ID).catch(() => null);
    if (!channel) return;

    const streamUrl = `https://twitch.tv/${stream.user_login}`;
    const previewUrl = stream.thumbnail_url.replace('{width}', '1280').replace('{height}', '720') + `?t=${Date.now()}`;

    const embed = new EmbedBuilder()
      .setTitle(`🔴 ${stream.user_name} ist jetzt live auf Twitch!`)
      .setURL(streamUrl)
      .setDescription(`**${stream.title}**\n\nSpielt: ${stream.game_name || 'Unbekannt'}`)
      .setImage(previewUrl)
      .setColor('#9146FF')
      .setTimestamp()
      .setFooter({ text: 'Twitch Livestream' });

    await channel.send({ content: `Hey zusammen, ${stream.user_name} ist live! Schaut rein: ${streamUrl}`, embeds: [embed] });
    console.log(`Twitch Announcement für ${stream.user_name} gesendet.`);
  } catch (err) {
    console.error('Fehler beim Senden des Twitch Announcements:', err);
  }
}

async function checkYouTube(client) {
  const config = await db.getAnnouncementsConfig();
  if (!config.youtube || config.youtube.length === 0) return;

  for (const channelId of config.youtube) {
    try {
      const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
      const feed = await parser.parseURL(feedUrl);

      if (feed.items && feed.items.length > 0) {
        // Get the latest video
        const latestVideo = feed.items[0];
        const videoId = latestVideo.id; // typically yt:video:ID

        const hasPosted = await db.hasPostedVideo(videoId);
        if (!hasPosted) {
          await postYouTubeAnnouncement(client, feed, latestVideo);
          await db.markVideoPosted(videoId);
        }
      }
    } catch (err) {
      console.error(`Fehler beim Prüfen des YouTube-Kanals ${channelId}:`, err.message);
    }
  }
}

async function postYouTubeAnnouncement(client, feed, video) {
  try {
    const channel = await client.channels.fetch(ANNOUNCEMENT_CHANNEL_ID).catch(() => null);
    if (!channel) return;

    const channelName = feed.title;
    const videoUrl = video.link;
    // Extract real ID from yt:video:ID
    const rawId = video.id.replace('yt:video:', '');
    const thumbnailUrl = `https://img.youtube.com/vi/${rawId}/maxresdefault.jpg`;

    const embed = new EmbedBuilder()
      .setTitle(`📺 Neues Video von ${channelName}!`)
      .setURL(videoUrl)
      .setDescription(`**${video.title}**`)
      .setImage(thumbnailUrl)
      .setColor('#FF0000')
      .setTimestamp()
      .setFooter({ text: 'YouTube Video' });

    await channel.send({ content: `Hey zusammen, es gibt ein neues Video von ${channelName}! Schaut es euch an: ${videoUrl}`, embeds: [embed] });
    console.log(`YouTube Announcement für ${channelName} gesendet.`);
  } catch (err) {
    console.error('Fehler beim Senden des YouTube Announcements:', err);
  }
}

export function startAnnouncementsScheduler(client) {
  if (isAnnouncementsStarted) return;
  isAnnouncementsStarted = true;

  // Run every 3 minutes
  cron.schedule('*/3 * * * *', async () => {
    if (!client.isReady()) return;

    console.log('Starte regelmäßigen Announcement-Check (Twitch & YouTube)...');
    await checkTwitch(client);
    await checkYouTube(client);
  });

  console.log('Announcements Scheduler gestartet (läuft alle 3 Minuten).');
}
