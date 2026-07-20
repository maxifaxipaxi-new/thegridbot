import { Client, GatewayIntentBits, EmbedBuilder, PermissionFlagsBits, ActivityType, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } from 'discord.js';
import dotenv from 'dotenv';
import { db } from './database/database.js';
import { startBirthdayScheduler } from './scheduler.js';
import { startDashboard } from './dashboard/server.js';
import { startAnnouncementsScheduler } from './announcements.js';
import { setupDynamicVCs } from './dynamic-vc.js';
import { startAutoDeleteScheduler } from './auto-delete.js';
import { handleTicketSetup, handleTicketButton } from './tickets.js';
import { setupLeveling, handleMessageXP, getRequiredXP, LEVEL_THRESHOLDS, LEVEL_ROLES, checkGridBoost } from './leveling.js';
import { startBackupScheduler } from './backup.js';
import { startRadio } from './radio.js';
import { handleWaitingRoomJoin, handleWaitingRoomButton } from './waiting-room.js';

dotenv.config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

const PREFIX = '?';

client.once('clientReady', async () => {
  console.log(`Bot ist online! Eingeloggt als ${client.user.tag}`);
  
  // Setze Status auf "Bitte nicht stören" (dnd) und Aktivität auf "Schaut zu .grid Community"
  client.user.setPresence({
    activities: [{ 
      name: '.grid Community', 
      type: ActivityType.Watching 
    }],
    status: 'dnd',
  });
  
  // Starte den Geburtstags-Scheduler
  startBirthdayScheduler(client);
  startAnnouncementsScheduler(client);
  startAutoDeleteScheduler(client);
  startBackupScheduler(client);
  
  // Dashboard starten
  startDashboard(client);

  // Dynamische Voice-Channels Handler
  setupDynamicVCs(client);

  // Starte Leveling (Voice-XP und Inaktivität)
  setupLeveling(client);

  // Setup Radio for all guilds
  const guilds = await db.getAllGuildConfigs();
  for (const guildId of Object.keys(guilds)) {
    const radioChannelId = await db.getRadioChannel(guildId);
    if (radioChannelId) {
      console.log(`Starte Radio in Channel ${radioChannelId} für Guild ${guildId}...`);
      startRadio(client, guildId, radioChannelId);
    }
  }
});

// Event-Handler für Prefix-Commands (?message und ?embed)
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // XP Handler aufrufen
  await handleMessageXP(message);

  // Reagiere mit ⏳ in dem Codes-Channel
  if (message.channel.id === '1519069474559496202') {
    message.react('⏳').catch(err => {
      console.error('Fehler beim Reagieren auf Code-Nachricht:', err);
    });
  }

  if (!message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  // ?message <nachricht>
  if (command === 'message') {
    const text = args.join(' ');
    if (!text) {
      try {
        const replyMsg = await message.reply('Bitte gib eine Nachricht an, die ich wiederholen soll! Beispiel: `?message Hallo Welt`');
        setTimeout(() => replyMsg.delete().catch(() => {}), 5000);
      } catch (err) {
        console.error('Fehler beim Senden der Antwort auf ?message:', err);
      }
      return;
    }

    // Versuche die Originalnachricht des Users zu löschen (nur auf Servern und mit Berechtigung)
    if (message.guild) {
      const canManage = message.channel.permissionsFor(client.user)?.has(PermissionFlagsBits.ManageMessages);
      if (canManage) {
        await message.delete().catch(() => {});
      }
    }

    await message.channel.send(text).catch(err => {
      console.error('Fehler beim Senden der Nachricht:', err);
    });
  }

  // ?embed <nachricht>
  if (command === 'embed') {
    const text = args.join(' ');
    if (!text) {
      try {
        const replyMsg = await message.reply('Bitte gib eine Nachricht an, die in einem Embed gesendet werden soll! Beispiel: `?embed Hallo Welt`');
        setTimeout(() => replyMsg.delete().catch(() => {}), 5000);
      } catch (err) {
        console.error('Fehler beim Senden der Antwort auf ?embed:', err);
      }
      return;
    }

    // Versuche die Originalnachricht des Users zu löschen
    if (message.guild) {
      const canManage = message.channel.permissionsFor(client.user)?.has(PermissionFlagsBits.ManageMessages);
      if (canManage) {
        await message.delete().catch(() => {});
      }
    }

    const embed = new EmbedBuilder()
      .setDescription(text)
      .setColor('#FFA500') // Orange für das Server-Design
      .setTimestamp()
      .setFooter({ 
        text: '🫵 | the grid.', 
        iconURL: 'https://my.thegridcom.xyz/public/logo.png'
      });

    await message.channel.send({ embeds: [embed] }).catch(err => {
      console.error('Fehler beim Senden des Embeds:', err);
    });
  }
});

// Event-Handler für Voice-State-Änderungen (für Warteraum)
client.on('voiceStateUpdate', (oldState, newState) => {
  handleWaitingRoomJoin(oldState, newState);
});

// Event-Handler für Slash-Commands und Buttons
client.on('interactionCreate', async (interaction) => {
  if (interaction.isButton()) {
    if (interaction.customId.startsWith('move_waiter_')) {
      return handleWaitingRoomButton(interaction);
    }
    return handleTicketButton(interaction);
  }

  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  try {
    // /ticketsetup
    if (commandName === 'ticketsetup') {
      return handleTicketSetup(interaction);
    }

    // /support
    if (commandName === 'support') {
      const embed = new EmbedBuilder()
        .setTitle('🛠️ Support & Hilfe-Center 🛠️')
        .setDescription(
          'Brauchst du Unterstützung oder hast du Fragen?\n\n' +
          '• **Ticket-Support:** Support ist über diesen Kanal per Ticket möglich: <#1294679527967948930> (bzw. [hier klicken](https://discord.com/channels/1294669609349283925/1294679527967948930)).\n' +
          '• **Wichtiger Hinweis:** Bitte sieh davon ab, Teammitglieder per DM (Direktnachricht) anzuschreiben.\n\n' +
          'Diese Nachricht ist nur für dich sichtbar.'
        )
        .setColor('#FFA500') // Orange für das Server-Design
        .setTimestamp()
        .setFooter({ 
          text: '🫵 | the grid.', 
          iconURL: 'https://my.thegridcom.xyz/public/logo.png'
        });

      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    // /help
    else if (commandName === 'help') {
      const embed = new EmbedBuilder()
        .setTitle('📚 Bot Befehlsübersicht')
        .setDescription('Hier findest du alle verfügbaren Befehle dieses Bots:')
        .addFields(
          { 
            name: '🚀 Slash-Befehle (mit / ausführen)', 
            value: '`/help` - Zeigt diese Hilfe-Übersicht.\n' +
                  '`/support` - Zeigt Support-Kontaktinfos (nur für dich sichtbar).\n' +
                  '`/geburtstag <tag> <monat>` - Trage deinen Geburtstag ein.\n' +
                  '`/datenschutz` - Zeigt die Datenschutzerklärung (nur für dich sichtbar).\n' +
                  '`/datenloeschung` - Löscht alle deine personenbezogenen Daten aus der Datenbank (nur für dich sichtbar).\n' +
                  '`/regeln` - Zeigt einen wichtigen Hinweis zu den Regeln.\n' +
                  '`/streamer` - Infos für Content Creator & Streamer.'
          }
        )
        .setColor('#FFA500') // Orange für das Server-Design
        .setTimestamp()
        .setFooter({ 
          text: '🫵 | the grid.', 
          iconURL: 'https://my.thegridcom.xyz/public/logo.png'
        });

      await interaction.reply({ embeds: [embed] });
    }

    // /geburtstag tag:X monat:Y
    else if (commandName === 'geburtstag') {
      const tag = interaction.options.getInteger('tag');
      const monat = interaction.options.getInteger('monat');

      // Plausibilitätsprüfung für Tage pro Monat
      const maxDays = [0, 31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
      if (tag > maxDays[monat]) {
        return interaction.reply({ 
          content: `❌ Ungültiges Datum! Der Monat **${monat}** hat keine **${tag}** Tage.`, 
          flags: MessageFlags.Ephemeral 
        });
      }

      await db.setUserBirthday(interaction.user.id, tag, monat);

      await interaction.reply({
        content: `🎉 Dein Geburtstag wurde erfolgreich auf den **${tag}.${monat}.** festgelegt! Ich werde dir an diesem Tag gratulieren.`,
        flags: MessageFlags.Ephemeral
      });
    }

    // /datenschutz
    else if (commandName === 'datenschutz') {
      const embed = new EmbedBuilder()
        .setTitle('🛡️ Datenschutzerklärung (DSGVO)')
        .setDescription(
          'Diese Erklärung informiert dich darüber, welche personenbezogenen Daten dieser Bot erfasst, speichert und wie diese verarbeitet werden.\n\n' +
          '### 1. Verantwortliche Stelle\n' +
          'Verantwortlich für die Datenverarbeitung des Bots ist die Serverleitung dieses Discord-Servers (**".grid Community"**).\n\n' +
          '### 2. Erhobene Daten und Verwendungszweck\n' +
          'Der Bot verarbeitet und speichert folgende Daten:\n' +
          '• **Discord-User-ID:** Zur eindeutigen Zuordnung von Geburtstagen und XP-Werten zu deinem Discord-Konto.\n' +
          '• **Geburtstag (Tag & Monat):** Um automatische Glückwünsche am Geburtstag im konfigurierten Kanal zu senden.\n' +
          '• **Erfahrungspunkte (XP) & Level:** Deine gesammelten XP, dein aktuelles Level sowie Zeitstempel deiner letzten Text- oder Voice-Aktivität zur Berechnung deines Ranks auf dem Leaderboard.\n' +
          '• **Server-Einstellungen:** Der Bot speichert zudem Gilden-IDs, Kanal-IDs sowie öffentliche Twitch-/YouTube-Namen für das Dashboard und die automatischen Ankündigungen (keine personenbezogenen Daten normaler Nutzer).\n\n' +
          '*Rechtsgrundlage:* Die Verarbeitung erfolgt auf Grundlage deiner ausdrücklichen Einwilligung (**Art. 6 Abs. 1 lit. a DSGVO**) durch die freiwillige Eingabe deines Geburtstags über den Befehl `/geburtstag` sowie durch deine aktive Nutzung des Chats und Voice-Chats.\n\n' +
          '### 3. Datenspeicherung & Sicherheit\n' +
          '• Alle Daten werden lokal in einer sicheren SQLite-Datenbank (`db.sqlite`) auf dem Server des Bot-Betreibers in Deutschland gespeichert.\n' +
          '• Es erfolgt **keine Weitergabe** der Daten an Dritte.\n' +
          '• Es werden **keine** Inhalte von Chatnachrichten dauerhaft protokolliert, sondern lediglich ein Zeitstempel der letzten Nachricht für den XP-Cooldown.\n\n' +
          '### 4. Deine Rechte (Auskunft & Löschung)\n' +
          'Du hast das Recht:\n' +
          '• Auskunft über deine gespeicherten Daten zu verlangen.\n' +
          '• Deine Daten jederzeit zu löschen oder zu korrigieren. Du kannst deinen Geburtstag jederzeit aktualisieren oder eine Löschung verlangen (wende dich hierzu an ein Teammitglied).\n\n' +
          'Diese Nachricht ist nur für dich sichtbar.'
        )
        .setColor('#FFA500') // Orange für das Server-Design
        .setTimestamp()
        .setFooter({ 
          text: '🫵 | the grid.', 
          iconURL: 'https://my.thegridcom.xyz/public/logo.png'
        });

      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    // /datenloeschung
    else if (commandName === 'datenloeschung') {
      const deleted = await db.deleteUserBirthday(interaction.user.id);
      
      const embed = new EmbedBuilder()
        .setTitle('🗑️ Datenlöschung (DSGVO)')
        .setDescription(
          deleted 
            ? '✅ **Erfolgreich gelöscht!**\n\nAlle deine gespeicherten personenbezogenen Daten (User-ID und dein Geburtstag) wurden vollständig aus unserem System gelöscht. Du bist nicht mehr in der Datenbank hinterlegt.'
            : 'ℹ️ **Keine Daten gefunden!**\n\nEs wurden keine gespeicherten personenbezogenen Daten zu deiner User-ID in unserem System gefunden.'
        )
        .setColor('#FFA500') // Orange für das Server-Design
        .setTimestamp()
        .setFooter({ 
          text: '🫵 | the grid.', 
          iconURL: 'https://my.thegridcom.xyz/public/logo.png'
        });

      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    // /streamer
    else if (commandName === 'streamer') {
      const embed = new EmbedBuilder()
        .setTitle('🎥 Content Creator & Streamer')
        .setDescription(
          'Du bist Streamer oder Content Creator und hast Lust auf eine unbezahlte Kooperation?\n\n' +
          'Melde dich gerne per **Support Ticket** bei uns im Kanal <#1294679527967948930> (bzw. [hier klicken](https://discord.com/channels/1294669609349283925/1294679527967948930)).\n\n' +
          'Wir helfen dir gerne mit **Cross-Promotion** und der Vernetzung in unserem **Content Creator Netzwerk**!'
        )
        .setColor('#FFA500') // Orange
        .setTimestamp()
        .setFooter({ 
          text: '🫵 | the grid.', 
          iconURL: 'https://my.thegridcom.xyz/public/logo.png'
        });

      await interaction.reply({ embeds: [embed] });
    }

    // /regeln
    else if (commandName === 'regeln') {
      const embed = new EmbedBuilder()
        .setTitle('📜 Server-Regeln & Verhaltenscodex')
        .setDescription(
          'Bitte achte darauf, dich an alle unsere Server-Regeln in <#1294674136081367133> zu halten.\n\n' +
          '**Wichtigste Grundregel:** Setze in jeder Situation vor allem deinen gesunden Menschenverstand ein! Miteinander statt gegeneinander.'
        )
        .setColor('#FFA500') // Orange
        .setTimestamp()
        .setFooter({ 
          text: '🫵 | the grid.', 
          iconURL: 'https://my.thegridcom.xyz/public/logo.png'
        });

      await interaction.reply({ embeds: [embed] });
    }

    // /dashboard
    else if (commandName === 'dashboard') {
      const member = interaction.member;
      const hasRole = member.roles.cache.has('1294670974020616294');

      if (hasRole) {
        await interaction.reply({ 
          content: 'Hier geht es zum Dashboard: https://my.thegridcom.xyz/dashboard/', 
          flags: MessageFlags.Ephemeral 
        });
      } else {
        await interaction.reply({ 
          content: 'nanana nur für echte frösche erlaubt.', 
          flags: MessageFlags.Ephemeral 
        });
      }
    }

    // /redeem
    else if (commandName === 'redeem') {
      const codeInput = interaction.options.getString('code').toUpperCase();
      
      const codeData = await db.getRedeemCode(codeInput);
      if (!codeData) {
        return interaction.reply({ content: '❌ Dieser Code existiert nicht oder ist ungültig.', flags: MessageFlags.Ephemeral });
      }

      if (codeData.active !== 1) {
        return interaction.reply({ content: '❌ Dieser Code ist derzeit deaktiviert und kann nicht mehr eingelöst werden.', flags: MessageFlags.Ephemeral });
      }

      const hasRedeemed = await db.hasUserRedeemedCode(interaction.user.id, codeInput);
      if (hasRedeemed) {
        return interaction.reply({ content: '❌ Du hast diesen Code bereits eingelöst!', flags: MessageFlags.Ephemeral });
      }

      try {
        await db.redeemCodeForUser(interaction.user.id, codeInput, codeData.xp);
        await interaction.reply({ content: `✅ Code erfolgreich eingelöst! Du hast **${codeData.xp} XP** erhalten!`, flags: MessageFlags.Ephemeral });
      } catch (err) {
        console.error('Fehler beim Einlösen des Codes:', err);
        await interaction.reply({ content: '❌ Es gab einen Fehler beim Einlösen des Codes.', flags: MessageFlags.Ephemeral });
      }
    }

    // /level
    else if (commandName === 'level') {
      const user = await db.getUser(interaction.user.id);
      
      // Bonus sofort überprüfen und updaten
      const hasTag = await checkGridBoost(client, interaction.user.id);
      user.hasBonus = hasTag ? 1 : 0;
      await db.updateUser(interaction.user.id, user);
      const level = user.level || 0;
      const xp = user.xp || 0;
      const nextXp = getRequiredXP(level);
      
      let prevXp = 0;
      if (level > 0) prevXp = LEVEL_THRESHOLDS[level];
      
      let progressBar = '';
      if (nextXp === 'MAX') {
         progressBar = '🟧🟧🟧🟧🟧🟧🟧🟧🟧🟧';
      } else {
         const xpInLevel = xp - prevXp;
         const xpNeeded = nextXp - prevXp;
         const progressPercent = Math.min(Math.max(xpInLevel / xpNeeded, 0), 1);
         const filledBars = Math.round(progressPercent * 10);
         progressBar = '🟧'.repeat(filledBars) + '⬛'.repeat(10 - filledBars);
      }
      
      const allUsers = await db.getAllUsers();
      const sortedUsers = Object.entries(allUsers).sort((a, b) => b[1].xp - a[1].xp);
      const rankIndex = sortedUsers.findIndex(u => u[0] === interaction.user.id);
      const rank = rankIndex !== -1 ? rankIndex + 1 : 'Unbekannt';

      const currentRole = level > 0 && LEVEL_ROLES[level] ? `<@&${LEVEL_ROLES[level]}>` : 'Kein Level';
      let nextLevelText = 'Maximales Level erreicht! 🏆';
      if (nextXp !== 'MAX') {
         const nextRole = LEVEL_ROLES[level + 1] ? `<@&${LEVEL_ROLES[level + 1]}>` : `Level ${level + 1}`;
         nextLevelText = `${nextRole} (noch ${nextXp - xp} XP)`;
      }

      let bonusText = hasTag 
          ? '\n\n🎉 **Bonus aktiv!** Danke, dass du unseren Servertag verwendest. Du sammelst 50% mehr XP mit jeder Nachricht und 2x so viele in Voicechannels.' 
          : '\n\n❌ **50% Bonus:** nicht aktiv (adoptiere unseren Servertag um mehr XP zu sammeln)';

      const embed = new EmbedBuilder()
        .setTitle(`XP Profil von ${interaction.user.username}`)
        .setDescription(`**Aktuelles Level:** ${currentRole}\n**Nächstes Level:** ${nextLevelText}\n\n**Erfahrungspunkte:** ${xp} XP\n**Server Rank:** #${rank}\n\n**Fortschritt zum nächsten Level:**\n${progressBar}${bonusText}\n\n[Für das öffentliche Leaderboard besuche unser Web-Dashboard!](https://my.thegridcom.xyz/leaderboard)`)
        .setColor('#FFA500')
        .setThumbnail(interaction.user.displayAvatarURL())
        .setFooter({ 
          text: '🫵 | the grid.', 
          iconURL: 'https://my.thegridcom.xyz/public/logo.png'
        });

      await interaction.reply({ embeds: [embed] });
    }

    // /top
    else if (commandName === 'top') {
      const allUsers = await db.getAllUsers();
      const sortedUsers = Object.entries(allUsers)
        .sort((a, b) => b[1].xp - a[1].xp)
        .slice(0, 10);

      let description = '';
      for (let i = 0; i < sortedUsers.length; i++) {
        const userId = sortedUsers[i][0];
        const xp = sortedUsers[i][1].xp;
        description += `**#${i + 1}** <@${userId}> — **${xp} XP**\n`;
      }

      if (description === '') description = 'Noch keine XP verteilt!\n';
      
      description += '\n[Für das öffentliche Leaderboard besuche unser Web-Dashboard!](https://my.thegridcom.xyz/leaderboard)';

      const embed = new EmbedBuilder()
        .setTitle('🏆 XP Leaderboard (Top 10)')
        .setDescription(description)
        .setColor('#FFA500')
        .setFooter({ 
          text: '🫵 | the grid.', 
          iconURL: 'https://my.thegridcom.xyz/public/logo.png'
        });

      await interaction.reply({ embeds: [embed] });
    }

    // --- Dynamische Voice Channels Commands ---
    else if (['vc-rename', 'vc-limit', 'vc-lock', 'vc-unlock'].includes(commandName)) {
      const channel = interaction.member.voice.channel;
      if (!channel) {
        return interaction.reply({ content: '❌ Du musst dich in deinem Voice-Channel befinden, um diesen Befehl auszuführen!', flags: MessageFlags.Ephemeral });
      }

      const isDynamic = await db.isDynamicChannel(channel.id);
      if (!isDynamic) {
        return interaction.reply({ content: '❌ Dieser Befehl kann nur in dynamisch erstellten Voice-Channels verwendet werden.', flags: MessageFlags.Ephemeral });
      }

      const ownerId = await db.getDynamicChannelOwner(channel.id);
      if (ownerId !== interaction.user.id) {
        return interaction.reply({ content: '❌ Nur der Ersteller dieses Voice-Channels kann ihn verwalten!', flags: MessageFlags.Ephemeral });
      }

      if (commandName === 'vc-rename') {
        const name = interaction.options.getString('name');
        const prefixedName = `📞│ ${name}`;
        await channel.setName(prefixedName);
        await interaction.reply({ content: `✅ Voice-Channel wurde in **${prefixedName}** umbenannt.`, flags: MessageFlags.Ephemeral });
      }
      else if (commandName === 'vc-limit') {
        const limit = interaction.options.getInteger('anzahl');
        await channel.setUserLimit(limit);
        await interaction.reply({ content: `✅ Nutzerlimit wurde auf **${limit === 0 ? 'Unbegrenzt' : limit}** gesetzt.`, flags: MessageFlags.Ephemeral });
      }
      else if (commandName === 'vc-lock') {
        await channel.permissionOverwrites.edit(channel.guild.roles.everyone, { Connect: false });
        await channel.permissionOverwrites.edit(interaction.user.id, { Connect: true });
        await interaction.reply({ content: '🔒 Voice-Channel wurde für neue Nutzer gesperrt.', flags: MessageFlags.Ephemeral });
      }
      else if (commandName === 'vc-unlock') {
        await channel.permissionOverwrites.edit(channel.guild.roles.everyone, { Connect: null });
        await interaction.reply({ content: '🔓 Voice-Channel ist wieder für alle geöffnet.', flags: MessageFlags.Ephemeral });
      }
    }
  } catch (error) {
    console.error(`Fehler bei Interaktion ${commandName}:`, error);
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content: 'Bei der Ausführung dieses Befehls ist ein Fehler aufgetreten!', flags: MessageFlags.Ephemeral });
      } else {
        await interaction.reply({ content: 'Bei der Ausführung dieses Befehls ist ein Fehler aufgetreten!', flags: MessageFlags.Ephemeral });
      }
    } catch (err) {
      console.error('Konnte Fehlerantwort nicht senden:', err);
    }
  }
});

if (!process.env.DISCORD_TOKEN) {
  console.error('Fehler: DISCORD_TOKEN fehlt in den Umgebungsvariablen.');
  process.exit(1);
}

// Starte das Web-Dashboard sofort, unabhängig vom Bot-Status
startDashboard(client);

client.login(process.env.DISCORD_TOKEN).catch(err => {
  console.error('Login beim Discord API Server fehlgeschlagen:', err);
});
