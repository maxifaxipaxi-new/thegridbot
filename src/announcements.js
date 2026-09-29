import cron from 'node-cron';
import axios from 'axios';
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { db } from './database/database.js';
const ANNOUNCEMENT_CHANNEL_ID = '1294799305357660214';

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

  for (const streamer of config.twitch) {
    try {
      const res = await axios.get(`https://api.twitch.tv/helix/streams?user_login=${streamer.username}`, {
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
          await sendTwitchDM(client, stream, streamer.discordUserId);
          await db.markStreamPosted(streamId);
        }
      }
    } catch (err) {
      console.error(`Fehler beim Prüfen des Twitch-Streams von ${streamer.username}:`, err.response?.data || err.message);
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

    await channel.send({ content: `<@&1528762995923226866>\nHey zusammen, ${stream.user_name} ist live! Schaut rein: ${streamUrl}`, embeds: [embed] });
    console.log(`Twitch Announcement für ${stream.user_name} gesendet.`);
  } catch (err) {
    console.error('Fehler beim Senden des Twitch Announcements:', err);
  }
}

async function sendTwitchDM(client, stream, discordUserId) {
  try {
    if (!discordUserId) return;
    const user = await client.users.fetch(discordUserId).catch(() => null);
    if (!user) return;

    const streamUrl = `https://twitch.tv/${stream.user_login}`;
    
    const embed = new EmbedBuilder()
      .setTitle(`🔴 Bereit deinen Stream anzukündigen?`)
      .setDescription(`Dein Twitch-Stream **${stream.title}** wurde als live erkannt!\n\nKlicke auf den Button unten, um den Stream im Ankündigungs-Channel zu posten.\n\n*Hinweis: Jeder Stream darf nur einmalig angekündigt werden.*`)
      .setColor('#9146FF');

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`announce_twitch_${stream.user_login}`)
        .setLabel('Jetzt ankündigen')
        .setStyle(ButtonStyle.Success)
    );
    
    await user.send({ embeds: [embed], components: [row] });
  } catch (err) {
    console.error('Fehler beim Senden der DM:', err);
  }
}

export async function handleTwitchAnnouncementButton(interaction) {
  const parts = interaction.customId.split('_');
  const user_login = parts[2];
  
  // Disable button
  await interaction.update({ components: [] }).catch(() => {});
  
  const token = await getTwitchToken();
  if (!token) {
    return interaction.followUp({ content: '❌ Interner Fehler: Twitch API Token konnte nicht abgerufen werden.', flags: MessageFlags.Ephemeral });
  }
  
  const clientId = process.env.TWITCH_CLIENT_ID;
  try {
    const res = await axios.get(`https://api.twitch.tv/helix/streams?user_login=${user_login}`, {
      headers: { 'Client-ID': clientId, 'Authorization': `Bearer ${token}` }
    });
    
    const data = res.data.data;
    if (data && data.length > 0) {
      const stream = data[0];
      await postTwitchAnnouncement(interaction.client, stream);
      await interaction.followUp({ content: '✅ Stream wurde erfolgreich angekündigt!', flags: MessageFlags.Ephemeral });
    } else {
      await interaction.followUp({ content: '❌ Konnte den Stream nicht finden (vielleicht bist du schon offline?).', flags: MessageFlags.Ephemeral });
    }
  } catch (err) {
    console.error('Fehler bei Button Interaction für Twitch:', err);
    await interaction.followUp({ content: '❌ Es gab einen Fehler bei der Kommunikation mit Twitch.', flags: MessageFlags.Ephemeral });
  }
}

export function startAnnouncementsScheduler(client) {
  if (isAnnouncementsStarted) return;
  isAnnouncementsStarted = true;

  // Run every 3 minutes
  cron.schedule('*/3 * * * *', async () => {
    if (!client.isReady()) return;

    console.log('Starte regelmäßigen Announcement-Check (Twitch)...');
    await checkTwitch(client);
  });

  console.log('Announcements Scheduler gestartet (läuft alle 3 Minuten).');
}
