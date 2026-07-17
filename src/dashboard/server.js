import express from 'express';
import session from 'express-session';
import axios from 'axios';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import { db } from '../database/database.js';
import { deleteTicketChannel } from '../tickets.js';
import { updateUserXPFromDashboard } from '../leveling.js';
import { EmbedBuilder } from 'discord.js';
import multer from 'multer';
import { startRadio, stopRadio } from '../radio.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, '..', 'database', 'db.sqlite');

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, '..', 'database'));
  },
  filename: function (req, file, cb) {
    cb(null, 'db.sqlite'); // Overwrite db.sqlite
  }
});
const upload = multer({ storage: storage });

export function startDashboard(client) {
  const app = express();
  const PORT = process.env.DASHBOARD_PORT || 3000;

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use('/public', express.static(path.join(__dirname, 'public')));

  app.use(session({
    secret: process.env.SESSION_SECRET || 'fallback_secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 24 // 1 day
    }
  }));

  const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
  const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
  const REDIRECT_URI = process.env.OAUTH_CALLBACK_URL;
  const OWNER_ID = process.env.OWNER_ID;
  const BOT_TOKEN = process.env.DISCORD_TOKEN;
  const TEAM_ROLE_ID = process.env.TEAM_ROLE_ID; // The role ID that is allowed to view
  const GUILD_ID = '1294669609349283925';

  const checkAuth = (req, res, next) => {
    if (req.session.user && (req.session.user.isOwner || req.session.user.isTeam)) {
      return next();
    }
    res.redirect('/');
  };

  const checkOwner = (req, res, next) => {
    if (req.session.user && req.session.user.isOwner) {
      return next();
    }
    res.redirect('/error');
  };

  app.get('/', (req, res) => {
    if (req.session.user) {
      if (req.session.user.isOwner || req.session.user.isTeam) {
        return res.redirect('/dashboard');
      } else {
        return res.redirect('/error');
      }
    }
    res.render('index', { clientId: CLIENT_ID, redirectUri: encodeURIComponent(REDIRECT_URI) });
  });

  app.get('/leaderboard', async (req, res) => {
    try {
      const allUsers = await db.getAllUsers();
      const sortedUsers = Object.entries(allUsers)
        .sort((a, b) => b[1].xp - a[1].xp)
        .slice(0, 10);

      // Try to fetch usernames and avatars from client cache
      const leaderboardData = [];
      for (const [userId, userData] of sortedUsers) {
        let username = 'Unbekannt';
        let avatarUrl = 'https://cdn.discordapp.com/embed/avatars/0.png';

        if (client.isReady()) {
          try {
            const user = await client.users.fetch(userId);
            if (user) {
              username = user.username;
              avatarUrl = user.displayAvatarURL();
            }
          } catch (e) {
            // Ignore error if user is not found
          }
        }
        
        leaderboardData.push({
          id: userId,
          username,
          avatarUrl,
          xp: userData.xp,
          level: userData.level || 0
        });
      }

      res.render('leaderboard', { leaderboard: leaderboardData });
    } catch (err) {
      console.error('Fehler beim Laden des Leaderboards:', err);
      res.status(500).send('Interner Serverfehler beim Laden des Leaderboards.');
    }
  });

  app.get('/auth/discord', (req, res) => {
    const url = `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify`;
    res.redirect(url);
  });

  app.get('/auth/discord/callback', async (req, res) => {
    const code = req.query.code;
    if (!code) {
      return res.redirect('/?error=NoCodeProvided');
    }

    try {
      // Token Exchange
      const params = new URLSearchParams();
      params.append('client_id', CLIENT_ID);
      params.append('client_secret', CLIENT_SECRET);
      params.append('grant_type', 'authorization_code');
      params.append('code', code);
      params.append('redirect_uri', REDIRECT_URI);

      const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', params.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });

      const accessToken = tokenResponse.data.access_token;

      // Get user info
      const userResponse = await axios.get('https://discord.com/api/users/@me', {
        headers: { authorization: `Bearer ${accessToken}` }
      });
      const userData = userResponse.data;

      // Verify role in the specific guild using Bot API (works even if bot is offline)
      let isTeam = false;
      let isOwner = (userData.id === OWNER_ID);

      try {
        const guildMemberResponse = await axios.get(`https://discord.com/api/guilds/${GUILD_ID}/members/${userData.id}`, {
          headers: { Authorization: `Bot ${BOT_TOKEN}` }
        });
        const roles = guildMemberResponse.data.roles;
        if (TEAM_ROLE_ID && roles.includes(TEAM_ROLE_ID)) {
          isTeam = true;
        }
      } catch (err) {
        console.error('Error fetching guild member (User might not be in the server or Bot lacks permissions):', err.response?.status);
      }

      // Allow access if owner or has the team role
      if (isOwner || isTeam) {
        userData.isOwner = isOwner;
        userData.isTeam = isTeam;
        req.session.user = userData;
        res.redirect('/dashboard');
      } else {
        res.redirect('/error');
      }
    } catch (error) {
      console.error('Error during Discord OAuth callback:', error.response?.data || error.message);
      res.redirect('/?error=OAuthFailed');
    }
  });

  app.get('/dashboard', checkAuth, async (req, res) => {
    // Determine Bot Status and Member count
    let botStatus = client.isReady() ? 'Online' : 'Offline';
    let targetGuildMemberCount = 'N/A';
    let totalGuilds = client.guilds.cache.size;
    let totalUsers = client.users.cache.size;
    let botPing = client.ws.ping;

    if (client.isReady()) {
      const targetGuild = client.guilds.cache.get(GUILD_ID);
      if (targetGuild) {
        targetGuildMemberCount = targetGuild.memberCount;
      }
    } else {
      botPing = 0;
      // Optionally fetch member count via REST if bot is offline
      try {
        const guildRes = await axios.get(`https://discord.com/api/guilds/${GUILD_ID}?with_counts=true`, {
          headers: { Authorization: `Bot ${BOT_TOKEN}` }
        });
        targetGuildMemberCount = guildRes.data.approximate_member_count || 'N/A';
      } catch (e) {
        // Ignore
      }
    }

    const stats = {
      guilds: totalGuilds,
      users: totalUsers,
      ping: botPing,
      botStatus: botStatus,
      targetGuildMembers: targetGuildMemberCount
    };
    
    res.render('dashboard', { user: req.session.user, stats, error: req.query.error, success: req.query.success });
  });

  // DB Editor Routes (Owner Only)
  app.get('/dashboard/db', checkOwner, async (req, res) => {
    res.render('db_editor', { user: req.session.user, error: req.query.error, success: req.query.success });
  });

  app.get('/dashboard/db/download', checkOwner, (req, res) => {
    res.download(dbPath, 'db.sqlite', (err) => {
      if (err) console.error('Fehler beim Download:', err);
    });
  });

  app.post('/dashboard/db', checkOwner, upload.single('dbFile'), async (req, res) => {
    try {
      if (!req.file) {
        return res.redirect('/dashboard/db?error=Keine Datei ausgewählt.');
      }
      res.redirect('/dashboard/db?success=Datenbank hochgeladen! Bitte starte den Bot neu, um die neue Datenbank zu laden.');
    } catch (err) {
      res.redirect('/dashboard/db?error=Fehler beim Hochladen der Datenbank.');
    }
  });

  // Announcements Routes (Mods/Team)
  app.get('/dashboard/announcements', checkAuth, async (req, res) => {
    const config = await db.getAnnouncementsConfig();
    const errorMsg = req.query.error;
    res.render('announcements', { user: req.session.user, config, errorMsg });
  });

  app.post('/dashboard/announcements/add', checkAuth, async (req, res) => {
    const type = req.body.type;
    let id = req.body.id?.trim();
    if (id) {
      if (type === 'twitch') {
        await db.addTwitchStreamer(id);
      } else if (type === 'youtube') {
        // Falls der Nutzer einen @Handle eingibt (oder nicht UC...)
        if (id.startsWith('@') || !id.startsWith('UC')) {
          try {
            const handle = id.startsWith('@') ? id : `@${id}`;
            const response = await fetch(`https://www.youtube.com/${handle}`);
            const html = await response.text();
            const match = html.match(/channel\/([Uu][Cc][a-zA-Z0-9_-]{22})/);
            if (match && match[1]) {
              id = match[1]; // Handle erfolgreich in UC-ID umgewandelt
            } else {
              return res.redirect('/dashboard/announcements?error=YouTube Kanal nicht gefunden');
            }
          } catch (err) {
            console.error('Fehler beim Auflösen des YouTube Handles:', err);
            return res.redirect('/dashboard/announcements?error=Netzwerkfehler bei YouTube');
          }
        }
        await db.addYouTubeChannel(id);
      }
    }
    res.redirect('/dashboard/announcements');
  });

  app.post('/dashboard/announcements/remove', checkAuth, async (req, res) => {
    const type = req.body.type;
    const id = req.body.id;
    if (id) {
      if (type === 'twitch') await db.removeTwitchStreamer(id);
      if (type === 'youtube') await db.removeYouTubeChannel(id);
    }
    res.redirect('/dashboard/announcements');
  });

  // Ticket Management Routes (Mods/Team)
  app.get('/dashboard/tickets', checkAuth, async (req, res) => {
    const tickets = await db.getTickets();
    res.render('tickets', { user: req.session.user, tickets });
  });

  app.get('/dashboard/tickets/:id', checkAuth, async (req, res) => {
    const ticketId = req.params.id;
    const tickets = await db.getTickets();
    const ticketData = tickets[ticketId];

    if (!ticketData) {
      return res.redirect('/dashboard/tickets');
    }

    let messages = [];
    let channel = null;

    if (client.isReady()) {
      channel = client.channels.cache.get(ticketId);
      if (channel) {
        try {
          const fetched = await channel.messages.fetch({ limit: 50 });
          messages = Array.from(fetched.values()).reverse();
        } catch (err) {
          console.error('Fehler beim Laden der Ticket-Nachrichten:', err);
        }
      }
    }

    res.render('ticket_view', { user: req.session.user, ticket: ticketData, ticketId, messages, channelExists: !!channel });
  });

  app.post('/dashboard/tickets/:id/reply', checkAuth, async (req, res) => {
    const ticketId = req.params.id;
    const { content } = req.body;
    
    if (client.isReady() && content) {
      const channel = client.channels.cache.get(ticketId);
      if (channel) {
        const embed = new EmbedBuilder()
          .setDescription(content)
          .setColor('#FFA500')
          .setFooter({ 
            text: `🫵 | the grid. | Geantwortet von: ${req.session.user.username}`, 
            iconURL: 'https://images-ext-1.discordapp.net/external/R5SJEWiQb8Qhdj8qYdHWNdhKKufBHGDAFm99OTi7WRc/https/imgur.com/p9YGWp5.png?format=webp&quality=lossless'
          });
        
        await channel.send({ embeds: [embed] }).catch(err => console.error('Fehler beim Senden in Ticket:', err));
      }
    }
    res.redirect(`/dashboard/tickets/${ticketId}`);
  });

  app.post('/dashboard/tickets/:id/close', checkAuth, async (req, res) => {
    const ticketId = req.params.id;
    const tickets = await db.getTickets();
    const ticketData = tickets[ticketId];

    if (ticketData) {
      if (client.isReady()) {
        const channel = client.channels.cache.get(ticketId);
        if (channel) {
           await channel.permissionOverwrites.edit(ticketData.userId, { SendMessages: false }).catch(() => {});
           
           const closeEmbed = new EmbedBuilder()
             .setDescription(`🔒 Dieses Ticket wurde von Moderator ${req.session.user.username} (via Dashboard) geschlossen. Es kann nun gelöscht werden.`)
             .setColor('#ef4444');
             
           await channel.send({ embeds: [closeEmbed] }).catch(() => {});
        }
      }
      await db.closeTicket(ticketId);
    }
    res.redirect(`/dashboard/tickets/${ticketId}`);
  });

  app.post('/dashboard/tickets/:id/reopen', checkAuth, async (req, res) => {
    const ticketId = req.params.id;
    const tickets = await db.getTickets();
    const ticketData = tickets[ticketId];

    if (ticketData) {
      if (client.isReady()) {
        const channel = client.channels.cache.get(ticketId);
        if (channel) {
           await channel.permissionOverwrites.edit(ticketData.userId, { SendMessages: true }).catch(() => {});
           
           const reopenEmbed = new EmbedBuilder()
             .setDescription(`🔓 Dieses Ticket wurde von Moderator ${req.session.user.username} (via Dashboard) wieder geöffnet.`)
             .setColor('#10b981');
             
           await channel.send({ embeds: [reopenEmbed] }).catch(() => {});
        }
      }
      await db.reopenTicket(ticketId);
    }
    res.redirect(`/dashboard/tickets/${ticketId}`);
  });

  app.post('/dashboard/tickets/:id/delete', checkAuth, async (req, res) => {
    const ticketId = req.params.id;
    
    if (client.isReady()) {
      const channel = client.channels.cache.get(ticketId);
      if (channel) {
        await deleteTicketChannel(channel, req.session.user.username, client);
      } else {
        await db.deleteTicket(ticketId);
      }
    } else {
      await db.deleteTicket(ticketId);
    }
    
    res.redirect('/dashboard/tickets');
  });

  // Ban Management Routes (Mods/Team)
  app.get('/dashboard/bans', checkAuth, async (req, res) => {
    let bans = [];
    if (client.isReady()) {
      try {
        const guild = client.guilds.cache.get(GUILD_ID);
        if (guild) {
          const fetchedBans = await guild.bans.fetch();
          bans = fetchedBans.map(ban => ({
            user: ban.user,
            reason: ban.reason || 'Kein Grund angegeben'
          }));
        }
      } catch (err) {
        console.error('Fehler beim Laden der Bans:', err);
      }
    }
    res.render('bans', { user: req.session.user, bans, errorMsg: req.query.error, successMsg: req.query.success });
  });

  app.post('/dashboard/bans/ban', checkAuth, async (req, res) => {
    const userId = req.body.userId?.trim();
    const reason = req.body.reason?.trim() || 'Über Dashboard gebannt';
    if (!userId) return res.redirect('/dashboard/bans?error=Bitte eine User-ID eingeben');
    if (client.isReady()) {
      try {
        const guild = client.guilds.cache.get(GUILD_ID);
        if (guild) {
          await guild.members.ban(userId, { reason });
          return res.redirect('/dashboard/bans?success=User erfolgreich gebannt');
        }
      } catch (err) {
        console.error('Fehler beim Bannen:', err);
        return res.redirect('/dashboard/bans?error=Fehler beim Bannen (Evtl. ungültige ID oder fehlende Rechte)');
      }
    }
    res.redirect('/dashboard/bans?error=Bot ist offline');
  });

  app.post('/dashboard/bans/unban', checkAuth, async (req, res) => {
    const userId = req.body.userId?.trim();
    if (client.isReady() && userId) {
      try {
        const guild = client.guilds.cache.get(GUILD_ID);
        if (guild) {
          await guild.bans.remove(userId);
          return res.redirect('/dashboard/bans?success=User erfolgreich entbannt');
        }
      } catch (err) {
        console.error('Fehler beim Entbannen:', err);
        return res.redirect('/dashboard/bans?error=Fehler beim Entbannen');
      }
    }
    res.redirect('/dashboard/bans');
  });

  // Audit Logs (Mods/Team)
  app.get('/dashboard/audit', checkAuth, async (req, res) => {
    let logs = [];
    if (client.isReady()) {
      try {
        const guild = client.guilds.cache.get(GUILD_ID);
        if (guild) {
          const auditLogs = await guild.fetchAuditLogs({ limit: 10 });
          logs = auditLogs.entries.map(entry => ({
            action: entry.actionType,
            executor: entry.executor,
            target: entry.target,
            reason: entry.reason,
            date: entry.createdAt
          }));
        }
      } catch (err) {
        console.error('Fehler beim Laden des Audit Logs:', err);
      }
    }
    res.render('audit', { user: req.session.user, logs });
  });

  // XP Management Routes (Mods/Team)
  app.get('/dashboard/xp', checkAuth, async (req, res) => {
    let usersList = [];
    try {
      const allUsers = await db.getAllUsers();
      
      for (const [userId, userData] of Object.entries(allUsers)) {
        let username = 'Unbekannt';
        if (client.isReady()) {
          try {
            const u = await client.users.fetch(userId);
            if (u) username = u.username;
          } catch(e) {}
        }
        usersList.push({ 
          id: userId, 
          username, 
          xp: userData.xp, 
          level: userData.level || 0, 
          hasBonus: userData.hasBonus === 1 
        });
      }
      
      usersList.sort((a, b) => b.xp - a.xp);
    } catch(err) {
      console.error('Fehler beim Laden der XP Liste:', err);
    }
    res.render('xp_editor', { user: req.session.user, usersList, errorMsg: req.query.error, successMsg: req.query.success });
  });

  app.post('/dashboard/xp/edit', checkAuth, async (req, res) => {
    const { userId, newXp } = req.body;
    if (!userId || newXp === undefined) return res.redirect('/dashboard/xp?error=Bitte alle Felder ausfüllen');
    
    try {
      await updateUserXPFromDashboard(client, userId, newXp);
      res.redirect('/dashboard/xp?success=XP und Level erfolgreich aktualisiert');
    } catch(err) {
      console.error('Fehler beim Aktualisieren der XP:', err);
      res.redirect('/dashboard/xp?error=Fehler beim Aktualisieren');
    }
  });

  // Birthdays (Mods/Team)
  app.get('/dashboard/birthdays', checkAuth, async (req, res) => {
    const birthdays = await db.getAllBirthdays();
    res.render('birthdays', { user: req.session.user, birthdays, errorMsg: req.query.error, successMsg: req.query.success });
  });

  app.post('/dashboard/birthdays/delete', checkAuth, async (req, res) => {
    const userId = req.body.userId?.trim();
    if (userId) {
      await db.deleteUserBirthday(userId);
      return res.redirect('/dashboard/birthdays?success=Geburtstag gelöscht');
    }
    res.redirect('/dashboard/birthdays');
  });

  // Bot Management Routes (Owner Only)
  app.post('/api/bot/start', checkOwner, async (req, res) => {
    if (!client.isReady()) {
      try {
        await client.login(BOT_TOKEN);
        for (let i = 0; i < 50; i++) {
          if (client.isReady()) break;
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        res.redirect('/dashboard?success=Bot gestartet');
      } catch (err) {
        res.redirect('/dashboard?error=Fehler beim Starten');
      }
    } else {
      res.redirect('/dashboard?error=Bot ist bereits online');
    }
  });

  app.post('/api/bot/stop', checkOwner, async (req, res) => {
    if (client.isReady()) {
      client.destroy();
      res.redirect('/dashboard?success=Bot gestoppt');
    } else {
      res.redirect('/dashboard?error=Bot ist bereits offline');
    }
  });

  app.get('/error', (req, res) => {
    res.render('error');
  });

  app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
  });

  // Public Legal Pages
  app.get('/impressum', (req, res) => {
    res.render('impressum');
  });

  app.get('/datenschutzerklaerung', (req, res) => {
    res.render('datenschutz');
  });

  app.get('/tos', (req, res) => {
    res.render('tos');
  });

  // --- RADIO MANAGEMENT ---
  app.get('/dashboard/radio', checkOwner, async (req, res) => {
    const guild = client.guilds.cache.get('1294669609349283925');
    let voiceChannels = [];
    if (guild) {
      voiceChannels = guild.channels.cache
        .filter(c => c.isVoiceBased())
        .map(c => ({ id: c.id, name: c.name }));
    }
    const currentRadioChannelId = await db.getRadioChannel('1294669609349283925');
    
    res.render('radio', { 
      user: req.session.user, 
      voiceChannels, 
      currentRadioChannelId,
      errorMsg: req.query.error, 
      successMsg: req.query.success 
    });
  });

  app.post('/dashboard/radio', checkOwner, async (req, res) => {
    const { action, channelId } = req.body;
    const guildId = '1294669609349283925';

    try {
      if (action === 'connect') {
        if (!channelId) return res.redirect('/dashboard/radio?error=Bitte wähle einen Kanal aus.');
        
        // Save to DB and Start
        await db.setRadioChannel(guildId, channelId);
        await startRadio(client, guildId, channelId);
        
        return res.redirect('/dashboard/radio?success=Bot erfolgreich verbunden und spielt Radio!');
      } else if (action === 'disconnect') {
        // Remove from DB and Stop
        await db.setRadioChannel(guildId, null);
        stopRadio(guildId);
        
        return res.redirect('/dashboard/radio?success=Bot erfolgreich vom Voice getrennt.');
      }
    } catch (err) {
      console.error('Fehler beim Radio:', err);
      return res.redirect('/dashboard/radio?error=Es gab einen Fehler bei der Aktion.');
    }
  });

  // Server Start
  app.listen(PORT, () => {
    console.log(`Dashboard Web Server läuft auf Port ${PORT}`);
  });
}
