import { Client, GatewayIntentBits, EmbedBuilder, PermissionFlagsBits, ActivityType, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import dotenv from 'dotenv';
import { db } from './database/database.js';
import { startDashboard } from './dashboard/server.js';
import { startAnnouncementsScheduler, handleTwitchAnnouncementButton } from './announcements.js';
import { setupDynamicVCs } from './dynamic-vc.js';
import { startAutoDeleteScheduler } from './auto-delete.js';
import { handleTicketSetup, handleTicketButton } from './tickets.js';
import { setupLeveling, handleMessageXP, getRequiredXP, LEVEL_THRESHOLDS, LEVEL_ROLES, checkGridBoost, checkLevelUp } from './leveling.js';
import { startBackupScheduler } from './backup.js';
import { startRadio } from './radio.js';
import { handleWaitingRoomJoin, handleWaitingRoomButton } from './waiting-room.js';
import { startGiveawayScheduler } from './giveaways.js';

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

  startAnnouncementsScheduler(client);
  startAutoDeleteScheduler(client);
  startBackupScheduler(client);
  startGiveawayScheduler(client);
  console.log('Giveaway Scheduler gestartet (läuft minütlich).');

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
        setTimeout(() => replyMsg.delete().catch(() => { }), 5000);
      } catch (err) {
        console.error('Fehler beim Senden der Antwort auf ?message:', err);
      }
      return;
    }

    // Versuche die Originalnachricht des Users zu löschen (nur auf Servern und mit Berechtigung)
    if (message.guild) {
      const canManage = message.channel.permissionsFor(client.user)?.has(PermissionFlagsBits.ManageMessages);
      if (canManage) {
        await message.delete().catch(() => { });
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
        setTimeout(() => replyMsg.delete().catch(() => { }), 5000);
      } catch (err) {
        console.error('Fehler beim Senden der Antwort auf ?embed:', err);
      }
      return;
    }

    // Versuche die Originalnachricht des Users zu löschen
    if (message.guild) {
      const canManage = message.channel.permissionsFor(client.user)?.has(PermissionFlagsBits.ManageMessages);
      if (canManage) {
        await message.delete().catch(() => { });
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
    if (interaction.customId.startsWith('announce_twitch_')) {
      return handleTwitchAnnouncementButton(interaction);
    }
    if (interaction.customId.startsWith('move_waiter_')) {
      return handleWaitingRoomButton(interaction);
    }
    if (interaction.customId.startsWith('vc_')) {
      const channel = interaction.member.voice.channel;
      if (!channel) {
        return interaction.reply({ content: '❌ Du musst dich in deinem Voice-Channel befinden!', flags: MessageFlags.Ephemeral });
      }

      const isDynamic = await db.isDynamicChannel(channel.id);
      if (!isDynamic) {
        return interaction.reply({ content: '❌ Dieser Button funktioniert nur in dynamischen Voice-Channels.', flags: MessageFlags.Ephemeral });
      }

      const ownerId = await db.getDynamicChannelOwner(channel.id);
      if (ownerId !== interaction.user.id) {
        return interaction.reply({ content: '❌ Nur der Ersteller dieses Voice-Channels kann ihn verwalten!', flags: MessageFlags.Ephemeral });
      }

      if (interaction.customId === 'vc_rename') {
        const modal = new ModalBuilder()
          .setCustomId('vc_rename_modal')
          .setTitle('Channel umbenennen');
        
        const nameInput = new TextInputBuilder()
          .setCustomId('vc_name_input')
          .setLabel('Neuer Name')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(50);
          
        modal.addComponents(new ActionRowBuilder().addComponents(nameInput));
        return interaction.showModal(modal);
      } 
      else if (interaction.customId === 'vc_limit') {
        const modal = new ModalBuilder()
          .setCustomId('vc_limit_modal')
          .setTitle('Nutzerlimit setzen');
        
        const limitInput = new TextInputBuilder()
          .setCustomId('vc_limit_input')
          .setLabel('Limit (0 für unbegrenzt)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(2);
          
        modal.addComponents(new ActionRowBuilder().addComponents(limitInput));
        return interaction.showModal(modal);
      }
      else if (interaction.customId === 'vc_lock') {
        await channel.permissionOverwrites.edit(channel.guild.roles.everyone, { Connect: false });
        await channel.permissionOverwrites.edit(interaction.user.id, { Connect: true });
        return interaction.reply({ content: '🔒 Voice-Channel wurde für neue Nutzer gesperrt.', flags: MessageFlags.Ephemeral });
      }
      else if (interaction.customId === 'vc_unlock') {
        await channel.permissionOverwrites.edit(channel.guild.roles.everyone, { Connect: null });
        return interaction.reply({ content: '🔓 Voice-Channel ist wieder für alle geöffnet.', flags: MessageFlags.Ephemeral });
      }
    }
    if (interaction.customId.startsWith('giveaway_join_')) {
      const giveawayId = parseInt(interaction.customId.replace('giveaway_join_', ''));
      const giveaway = await db.getGiveaway(giveawayId);
      
      if (!giveaway) {
        return interaction.reply({ content: '❌ Dieses Giveaway existiert nicht mehr.', flags: MessageFlags.Ephemeral });
      }
      if (giveaway.status !== 'active') {
        return interaction.reply({ content: '❌ Dieses Giveaway ist bereits beendet!', flags: MessageFlags.Ephemeral });
      }

      // Check minXp
      if (giveaway.minXp > 0) {
        const user = await db.getUser(interaction.user.id);
        if (user.xp < giveaway.minXp) {
          return interaction.reply({ 
            content: `❌ Du bist noch nicht berechtigt, an diesem Giveaway teilzunehmen!\nDir fehlen noch **${giveaway.minXp - user.xp} XP** (benötigt: ${giveaway.minXp} XP).\nSammle mehr Aktivität im Chat oder Voice-Channel!`, 
            flags: MessageFlags.Ephemeral 
          });
        }
      }

      const hasEntered = await db.hasUserEnteredGiveaway(giveawayId, interaction.user.id);
      if (hasEntered) {
        return interaction.reply({ content: 'Du nimmst bereits an diesem Giveaway teil!', flags: MessageFlags.Ephemeral });
      }

      await db.addGiveawayEntry(giveawayId, interaction.user.id);
      return interaction.reply({ content: '🎉 Du nimmst erfolgreich am Giveaway teil! Viel Glück!', flags: MessageFlags.Ephemeral });
    }

    return handleTicketButton(interaction);
  }

  if (interaction.isStringSelectMenu()) {
    if (interaction.customId === 'selfroles_select') {
      try {
        const roleId = interaction.values[0];
        const member = interaction.member;

        let added = false;
        if (member.roles.cache.has(roleId)) {
          await member.roles.remove(roleId);
        } else {
          await member.roles.add(roleId);
          added = true;
        }

        const roleNames = {
          '1464220894036496546': 'Gaming-News',
          '1528765222062522408': 'Event-Ping',
          '1528762995923226866': 'Stream-Ping',
          '1528765311904649296': 'Neuigkeiten-Ping'
        };

        const roleName = roleNames[roleId] || 'Unbekannte Rolle';

        await interaction.reply({
          content: added ? `✅ Dir wurde die Rolle **${roleName}** hinzugefügt.` : `❌ Dir wurde die Rolle **${roleName}** entfernt.`,
          flags: MessageFlags.Ephemeral
        });

        // Loggen in Channel 1387355992236363867
        const logChannel = await client.channels.fetch('1387355992236363867').catch(() => null);
        if (logChannel) {
          const logEmbed = new EmbedBuilder()
            .setTitle('Rollen-Update (Self-Role)')
            .setColor(added ? '#22c55e' : '#ef4444')
            .setDescription(`**User:** <@${member.id}> (${member.user.tag})\n**Rolle:** <@&${roleId}>\n**Aktion:** ${added ? 'Hinzugefügt' : 'Entfernt'}`)
            .setTimestamp()
            .setFooter({ text: `User ID: ${member.id}` });
          await logChannel.send({ embeds: [logEmbed] });
        }
      } catch (error) {
        console.error('Fehler bei Self-Roles:', error);
        await interaction.reply({ content: 'Es gab einen Fehler bei der Rollenvergabe. Hast du oder hat der Bot die nötigen Rechte?', flags: MessageFlags.Ephemeral });
      }
      return;
    }
  }

  if (interaction.isModalSubmit()) {
    if (interaction.customId === 'vc_rename_modal') {
      const name = interaction.fields.getTextInputValue('vc_name_input');
      const channel = interaction.member.voice.channel;
      if (channel) {
        const prefixedName = `📞│ ${name}`;
        await channel.setName(prefixedName).catch(() => {});
        return interaction.reply({ content: `✅ Voice-Channel wurde in **${prefixedName}** umbenannt.`, flags: MessageFlags.Ephemeral });
      }
    }
    else if (interaction.customId === 'vc_limit_modal') {
      const limitStr = interaction.fields.getTextInputValue('vc_limit_input');
      let limit = parseInt(limitStr, 10);
      if (isNaN(limit) || limit < 0) limit = 0;
      if (limit > 99) limit = 99;
      
      const channel = interaction.member.voice.channel;
      if (channel) {
        await channel.setUserLimit(limit).catch(() => {});
        return interaction.reply({ content: `✅ Nutzerlimit wurde auf **${limit === 0 ? 'Unbegrenzt' : limit}** gesetzt.`, flags: MessageFlags.Ephemeral });
      }
    }
  }

  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  try {
    // /ticketsetup
    if (commandName === 'ticketsetup') {
      return handleTicketSetup(interaction);
    }

    // /admincreate-selfroles
    if (commandName === 'admincreate-selfroles') {
      // Check admin permissions (Administrator)
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: 'Dazu hast du keine Rechte!', flags: MessageFlags.Ephemeral });
      }

      const embed = new EmbedBuilder()
        .setDescription(
          '# <:8309designerorange:1460236861661253643> Individuelle Rollenvergabe\n\n' +
          'Du kannst selber auswählen was du bei uns sehen kannst und was nicht. Zudem kannst du auswählen ob du Benachrichtungen empfängst oder nicht...\n\n' +
          '**🎮 Gaming-News**\nZugriff auf Channels mit Neuigkeiten, aktuellen Sales und Gratisgames.\n\n' +
          '**🎉 Event-Ping**\nWenn es gemeinsame Events wie Gamerunden (mit und ohne Gewinne am Ende etc.) gibt.\n\n' +
          '**🔴 Stream-Ping**\nWenn unsere Streamer live gehen.\n\n' +
          '**📢 Neuigkeiten-Ping**\nDiscord Serveränderungen an bspw. dem Bot und Co.'
        )
        .setColor('#FFA500')
        .setFooter({ text: 'Wähle eine Rolle aus dem Menü' });

      const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('selfroles_select')
          .setPlaceholder('Wähle eine Rolle aus...')
          .addOptions(
            new StringSelectMenuOptionBuilder()
              .setLabel('Gaming-News')
              .setDescription('News, Sales & Gratisgames')
              .setValue('1464220894036496546')
              .setEmoji('🎮'),
            new StringSelectMenuOptionBuilder()
              .setLabel('Event-Ping')
              .setDescription('Benachrichtigungen für Community Events')
              .setValue('1528765222062522408')
              .setEmoji('🎉'),
            new StringSelectMenuOptionBuilder()
              .setLabel('Stream-Ping')
              .setDescription('Benachrichtigungen für Live-Streams')
              .setValue('1528762995923226866')
              .setEmoji('🔴'),
            new StringSelectMenuOptionBuilder()
              .setLabel('Neuigkeiten-Ping')
              .setDescription('Bot Updates & Server-News')
              .setValue('1528765311904649296')
              .setEmoji('📢')
          )
      );

      await interaction.channel.send({ embeds: [embed], components: [row] });
      return interaction.reply({ content: 'Self-Roles Dropdown erfolgreich erstellt!', flags: MessageFlags.Ephemeral });
    }

    // /partner
    if (commandName === 'partner') {
      const embed = new EmbedBuilder()
        .setTitle('🤝 the grid. Partner: Frogly Studios')
        .setDescription(
          'Wir sind unglaublich stolz darauf, offizieller Partner von **Frogly Studios** zu sein!\n\n' +
          'Frogly Studios ist ein innovatives Game- und Softwarestudio, welches durch seinen erstklassigen Support ' +
          'die Entwicklung und den Betrieb dieses Bots (the grid.) maßgeblich ermöglicht.\n\n' +
          '**Erster Release auf Steam!** 🎉\n' +
          'Schau dir unbedingt ihre erste eigene Software auf Steam an und unterstütze sie:\n' +
          '🔗 **[frogly.fun](https://frogly.fun)**\n\n' +
          '*Vielen Dank an Frogly Studios für die großartige Zusammenarbeit!*'
        )
        .setColor('#FFA500')
        .setImage('https://my.thegridcom.xyz/public/logo.png') // or maybe leave out or use standard thumbnail
        .setThumbnail('https://my.thegridcom.xyz/public/logo.png')
        .setTimestamp()
        .setFooter({ text: 'the grid. x Frogly Studios' });

      await interaction.reply({ embeds: [embed] });
      return;
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

    // /weekly
    else if (commandName === 'weekly') {
      const user = await db.getUser(interaction.user.id);
      const now = Date.now();
      const sevenDays = 7 * 24 * 60 * 60 * 1000;
      
      if (now - (user.lastWeeklyTimestamp || 0) >= sevenDays) {
        user.xp += 100;
        user.lastWeeklyTimestamp = now;
        
        await checkLevelUp(client, interaction.guild, interaction.member, user);
        await db.updateUser(interaction.user.id, user);

        const embed = new EmbedBuilder()
          .setTitle('🎁 Wöchentlicher Bonus')
          .setDescription(`Du hast deinen wöchentlichen Bonus abgeholt!\n\n**+ 100 XP** wurden dir gutgeschrieben.\nDu hast nun **${user.xp} XP**.`)
          .setColor('#10b981')
          .setThumbnail(interaction.user.displayAvatarURL())
          .setFooter({
            text: '🫵 | the grid.',
            iconURL: 'https://my.thegridcom.xyz/public/logo.png'
          });

        await interaction.reply({ embeds: [embed] });
      } else {
        const timeLeft = sevenDays - (now - user.lastWeeklyTimestamp);
        const days = Math.floor(timeLeft / (1000 * 60 * 60 * 24));
        const hours = Math.floor((timeLeft % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        
        const embed = new EmbedBuilder()
          .setTitle('⏳ Nicht so schnell!')
          .setDescription(`Du hast deinen wöchentlichen Bonus bereits abgeholt.\n\nBitte warte noch **${days} Tage und ${hours} Stunden**, bevor du diesen Befehl erneut nutzen kannst.`)
          .setColor('#ef4444')
          .setFooter({
            text: '🫵 | the grid.',
            iconURL: 'https://my.thegridcom.xyz/public/logo.png'
          });

        await interaction.reply({ embeds: [embed] });
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
