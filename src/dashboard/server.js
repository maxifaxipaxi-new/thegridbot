import express from 'express';
import session from 'express-session';
import axios from 'axios';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'node:fs/promises';
import { db } from '../database/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, '..', 'database', 'db.json');

export function startDashboard(client) {
  const app = express();
  const PORT = process.env.DASHBOARD_PORT || 3000;

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());

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
    try {
      const data = await fs.readFile(dbPath, 'utf-8');
      res.render('db_editor', { user: req.session.user, dbContent: data });
    } catch (err) {
      res.send("Fehler beim Lesen der Datenbank.");
    }
  });

  app.post('/dashboard/db', checkOwner, async (req, res) => {
    try {
      const newContent = req.body.dbContent;
      JSON.parse(newContent); // Validate JSON
      await fs.writeFile(dbPath, newContent, 'utf-8');
      res.redirect('/dashboard?success=Datenbank gespeichert');
    } catch (err) {
      res.redirect('/dashboard?error=Ungültiges JSON oder Schreibfehler');
    }
  });

  // Announcements Routes (Owner Only)
  app.get('/dashboard/announcements', checkOwner, async (req, res) => {
    const config = await db.getAnnouncementsConfig();
    const errorMsg = req.query.error;
    res.render('announcements', { user: req.session.user, config, errorMsg });
  });

  app.post('/dashboard/announcements/add', checkOwner, async (req, res) => {
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

  app.post('/dashboard/announcements/remove', checkOwner, async (req, res) => {
    const type = req.body.type;
    const id = req.body.id;
    if (id) {
      if (type === 'twitch') await db.removeTwitchStreamer(id);
      if (type === 'youtube') await db.removeYouTubeChannel(id);
    }
    res.redirect('/dashboard/announcements');
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

  app.listen(PORT, () => {
    console.log(`Dashboard Web Server läuft auf Port ${PORT}`);
  });
}
