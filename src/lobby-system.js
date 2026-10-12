import { 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  ModalBuilder, 
  TextInputBuilder, 
  TextInputStyle, 
  StringSelectMenuBuilder, 
  StringSelectMenuOptionBuilder, 
  ChannelType, 
  PermissionFlagsBits,
  MessageFlags
} from 'discord.js';
import { db } from './database/database.js';

export const LOBBY_CHANNEL_ID = '1519069474559496202';
export const LOBBY_THREAD_NAME = '🔑・Lobby-Codes';
export const CODE_EXPIRE_MS = 8 * 60 * 60 * 1000; // 8 Stunden
export const LFG_EXPIRE_MS = 48 * 60 * 60 * 1000; // 48 Stunden
export const LFG_COOLDOWN_MS = 30 * 60 * 1000; // 30 Minuten

export async function getLobbyChannelId() {
  const custom = await db.getLobbyConfig('lobby_channel_id');
  return custom || LOBBY_CHANNEL_ID;
}

/**
 * Holt den dauerhaften Lobby-Codes Thread oder erstellt ihn
 */
export async function getOrCreateLobbyThread(client, channelIdOverride = null, targetMessage = null) {
  try {
    const targetChannelId = channelIdOverride || (await getLobbyChannelId());
    const channel = await client.channels.fetch(targetChannelId).catch(() => null);
    if (!channel || !channel.isTextBased()) return null;

    // 1. Wenn eine Ziel-Hauptnachricht übergeben wurde (z.B. frisch aus Dashboard):
    if (targetMessage) {
      if (targetMessage.thread) {
        await db.setLobbyConfig('lobby_thread_id', targetMessage.thread.id);
        return targetMessage.thread;
      }

      // Prüfe, ob alter Thread existiert und räume ihn ggf. auf
      const oldThreadId = await db.getLobbyConfig('lobby_thread_id');
      if (oldThreadId && oldThreadId !== targetMessage.id) {
        try {
          const oldThread = await channel.threads.fetch(oldThreadId).catch(() => null);
          if (oldThread) {
            const oldStarter = await channel.messages.fetch(oldThreadId).catch(() => null);
            if (oldStarter) await oldStarter.delete().catch(() => {});
            await oldThread.delete('Neues Panel gepostet').catch(() => {});
          }
        } catch (e) {}
      }

      // Starte Thread DIREKT auf der Hauptnachricht!
      const newThread = await targetMessage.startThread({
        name: LOBBY_THREAD_NAME,
        autoArchiveDuration: 10080,
        reason: 'Dauerhafter Sammel-Thread für geteilte Lobby-Codes'
      });

      await db.setLobbyConfig('lobby_thread_id', newThread.id);

      const initEmbed = new EmbedBuilder()
        .setTitle('🔑・Dauerhafte Lobby-Codes Zentrale')
        .setDescription(
          'Hier landen alle von der Community geteilten Lobby-Codes!\n\n' +
          '• Jeder Code enthält das Spiel, den Host und den Code selbst.\n' +
          '• **Automatische Bereinigung:** Jeder geteilte Code wird nach exakt **8 Stunden** automatisch gelöscht, damit immer nur frische Lobbys sichtbar sind.\n\n' +
          'Nutze das Panel im Hauptkanal, um deinen eigenen Code zu teilen!'
        )
        .setColor('#FFA500')
        .setFooter({ text: '🫵 | the grid. Lobbys & Codes' });

      await newThread.send({ embeds: [initEmbed] });
      return newThread;
    }

    // 2. Normaler Abruf: Prüfe gespeicherte Thread-ID
    const storedThreadId = await db.getLobbyConfig('lobby_thread_id');
    if (storedThreadId) {
      try {
        const thread = await channel.threads.fetch(storedThreadId).catch(() => null);
        if (thread && !thread.archived && !thread.locked) return thread;
        if (thread && thread.archived) {
          await thread.setArchived(false);
          return thread;
        }
      } catch (e) {}
    }

    // 3. Prüfe, ob die hinterlegte Hauptnachricht existiert und erstelle Thread darauf
    const panelMsgId = await db.getLobbyConfig('lobby_panel_message_id');
    if (panelMsgId) {
      try {
        const panelMsg = await channel.messages.fetch(panelMsgId).catch(() => null);
        if (panelMsg) {
          if (panelMsg.thread) {
            await db.setLobbyConfig('lobby_thread_id', panelMsg.thread.id);
            return panelMsg.thread;
          }
          const newThread = await panelMsg.startThread({
            name: LOBBY_THREAD_NAME,
            autoArchiveDuration: 10080,
            reason: 'Dauerhafter Sammel-Thread für geteilte Lobby-Codes'
          });
          await db.setLobbyConfig('lobby_thread_id', newThread.id);
          const initEmbed = new EmbedBuilder()
            .setTitle('🔑・Dauerhafte Lobby-Codes Zentrale')
            .setDescription(
              'Hier landen alle von der Community geteilten Lobby-Codes!\n\n' +
              '• Jeder Code enthält das Spiel, den Host und den Code selbst.\n' +
              '• **Automatische Bereinigung:** Jeder geteilte Code wird nach exakt **8 Stunden** automatisch gelöscht, damit immer nur frische Lobbys sichtbar sind.\n\n' +
              'Nutze das Panel im Hauptkanal, um deinen eigenen Code zu teilen!'
            )
            .setColor('#FFA500')
            .setFooter({ text: '🫵 | the grid. Lobbys & Codes' });

          await newThread.send({ embeds: [initEmbed] });
          return newThread;
        }
      } catch (e) {}
    }

    // 4. Suche in aktiven Threads
    const activeThreads = await channel.threads.fetchActive().catch(() => null);
    if (activeThreads && activeThreads.threads) {
      const found = activeThreads.threads.find(t => t.name === LOBBY_THREAD_NAME);
      if (found) {
        await db.setLobbyConfig('lobby_thread_id', found.id);
        return found;
      }
    }

    // 5. Suche in archivierten Threads
    const archivedThreads = await channel.threads.fetchArchived().catch(() => null);
    if (archivedThreads && archivedThreads.threads) {
      const found = archivedThreads.threads.find(t => t.name === LOBBY_THREAD_NAME);
      if (found) {
        await found.setArchived(false);
        await db.setLobbyConfig('lobby_thread_id', found.id);
        return found;
      }
    }

    // 6. Neu erstellen (Fallback falls keine Hauptnachricht)
    const newThread = await channel.threads.create({
      name: LOBBY_THREAD_NAME,
      autoArchiveDuration: 10080,
      type: ChannelType.PublicThread,
      reason: 'Dauerhafter Sammel-Thread für geteilte Lobby-Codes'
    });

    await db.setLobbyConfig('lobby_thread_id', newThread.id);

    const initEmbed = new EmbedBuilder()
      .setTitle('🔑・Dauerhafte Lobby-Codes Zentrale')
      .setDescription(
        'Hier landen alle von der Community geteilten Lobby-Codes!\n\n' +
        '• Jeder Code enthält das Spiel, den Host und den Code selbst.\n' +
        '• **Automatische Bereinigung:** Jeder geteilte Code wird nach exakt **8 Stunden** automatisch gelöscht, damit immer nur frische Lobbys sichtbar sind.\n\n' +
        'Nutze das Panel im Hauptkanal, um deinen eigenen Code zu teilen!'
      )
      .setColor('#FFA500')
      .setFooter({ text: '🫵 | the grid. Lobbys & Codes' });

    await newThread.send({ embeds: [initEmbed] });
    return newThread;
  } catch (err) {
    console.error('Fehler bei getOrCreateLobbyThread:', err);
    return null;
  }
}

/**
 * Erstellt das Control-Panel (Embed + Buttons)
 */
export function createLobbyPanel() {
  const embed = new EmbedBuilder()
    .setTitle('🎮 Lobbys & Mitspieler')
    .setDescription(
      'Willkommen in der **the grid.** Gaming-Zentrale!\n\n' +
      'Hier kannst du ganz einfach Mitspieler finden, eigene Codes teilen oder dich für deine Lieblingsspiele eintragen.\n\n' +
      '🔑 **Lobbycode teilen:**\n' +
      'Teile deinen Code für ein Game. Dein Code landet im dauerhaften Thread und wird nach **8 Stunden** automatisch gelöscht.\n\n' +
      '🔔 **Lobby-Alerts (Games wählen):**\n' +
      'Wähle deine Spiele aus. Wenn jemand eine Mitspieler-Runde startet, wirst du direkt benachrichtigt.\n\n' +
      '📢 **Mitspieler suchen:**\n' +
      'Erstelle einen temporären Mitspieler-Thread (30 Min. Cooldown). Alle eingetragenen User für das Game werden automatisch gepingt. Der Thread wird nach **48 Stunden** gelöscht.'
    )
    .setColor('#FFA500')
    .setThumbnail('https://my.thegridcom.org/public/logo.png')
    .setFooter({ text: '🫵 | the grid. Gaming Hub', iconURL: 'https://my.thegridcom.org/public/logo.png' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('lobby_btn_share_code')
      .setLabel('Lobbycode teilen')
      .setEmoji('🔑')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('lobby_btn_alerts')
      .setLabel('Lobby-Alerts (Games wählen)')
      .setEmoji('🔔')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('lobby_btn_lfg')
      .setLabel('Mitspieler suchen')
      .setEmoji('📢')
      .setStyle(ButtonStyle.Secondary)
  );

  return { embeds: [embed], components: [row] };
}

/**
 * Hintergrund-Scheduler für 8h-Code Löschung & 48h-Thread Löschung
 */
export function startLobbyScheduler(client) {
  setInterval(async () => {
    try {
      const now = Date.now();

      // 1. Abgelaufene Lobbycodes löschen (nach 8h)
      const expiredCodes = await db.getExpiredLobbyCodes(now);
      for (const item of expiredCodes) {
        try {
          const channel = await client.channels.fetch(item.threadId || item.channelId).catch(() => null);
          if (channel) {
            const msg = await channel.messages.fetch(item.messageId).catch(() => null);
            if (msg) {
              await msg.delete().catch(() => {});
            }
          }
        } catch (e) {}
        await db.deleteLobbyCode(item.messageId);
      }

      // 2. Abgelaufene LFG-Threads löschen (nach 48h)
      const expiredThreads = await db.getExpiredLfgThreads(now);
      for (const t of expiredThreads) {
        try {
          const thread = await client.channels.fetch(t.threadId).catch(() => null);
          if (thread && thread.isThread()) {
            await thread.send('⏳ Dieser Mitspieler-Thread ist nach 48 Stunden abgelaufen und wird geschlossen.').catch(() => {});
            
            // Starter-Benachrichtigung im Hauptkanal löschen
            try {
              const parentChannel = thread.parent || (await client.channels.fetch(thread.parentId).catch(() => null));
              if (parentChannel) {
                const starterMsg = await parentChannel.messages.fetch(thread.id).catch(() => null);
                if (starterMsg) await starterMsg.delete().catch(() => {});
              }
            } catch (e) {}

            await thread.delete('Abgelaufen nach 48h').catch(() => {});
          }
        } catch (e) {}
        await db.closeLfgThread(t.threadId);
      }
    } catch (err) {
      console.error('Fehler im Lobby Scheduler:', err);
    }
  }, 60 * 1000); // Jede Minute
}

/**
 * Event-Listener: Löscht automatisch Starter-Nachrichten im Hauptkanal, falls ein Thread gelöscht wird
 */
export function setupThreadDeleteListener(client) {
  client.on('threadDelete', async (thread) => {
    try {
      const parentChannel = thread.parent || (await client.channels.fetch(thread.parentId).catch(() => null));
      if (parentChannel) {
        const starterMsg = await parentChannel.messages.fetch(thread.id).catch(() => null);
        if (starterMsg) await starterMsg.delete().catch(() => {});
      }
      await db.closeLfgThread(thread.id);
    } catch (e) {}
  });
}

/**
 * Interaktions-Handler für alle Lobby-Buttons, Selects & Modals
 */
export async function handleLobbyInteraction(interaction) {
  // --- 1. BUTTONS ---
  if (interaction.isButton()) {
    // A) Lobbycode teilen
    if (interaction.customId === 'lobby_btn_share_code') {
      const modal = new ModalBuilder()
        .setCustomId('lobby_modal_share_code')
        .setTitle('Lobbycode teilen');

      const gameInput = new TextInputBuilder()
        .setCustomId('lobby_input_game')
        .setLabel('Spiel')
        .setPlaceholder('z.B. CS2, Valorant, Fortnite, Rocket League...')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(60);

      const codeInput = new TextInputBuilder()
        .setCustomId('lobby_input_code')
        .setLabel('Lobbycode oder Beitrittslink')
        .setPlaceholder('z.B. 1234-ABCD oder Invite-Link')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(150);

      const noteInput = new TextInputBuilder()
        .setCustomId('lobby_input_note')
        .setLabel('Zusatzinfo / Modus (Optional)')
        .setPlaceholder('z.B. Brauchen noch 2 für Ranked, Discord Pflicht!')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setMaxLength(300);

      modal.addComponents(
        new ActionRowBuilder().addComponents(gameInput),
        new ActionRowBuilder().addComponents(codeInput),
        new ActionRowBuilder().addComponents(noteInput)
      );

      return interaction.showModal(modal);
    }

    // B) Lobby-Alerts (Games wählen)
    if (interaction.customId === 'lobby_btn_alerts') {
      return renderUserAlertsMenu(interaction);
    }

    // C) Toggle Kein-Ping Button im Alerts-Menü
    if (interaction.customId === 'lobby_btn_toggle_noping') {
      const isCurrentlyNoPing = await db.getUserGlobalNoPing(interaction.user.id);
      const newNoPing = isCurrentlyNoPing ? 0 : 1;
      await db.setUserAlertNoPing(interaction.user.id, newNoPing);
      return renderUserAlertsMenu(interaction, true);
    }

    // D) Mitspieler suchen
    if (interaction.customId === 'lobby_btn_lfg') {
      const isOwner = interaction.user.id === process.env.OWNER_ID;
      if (!isOwner) {
        const lastUsed = await db.getLfgCooldown(interaction.user.id);
        const diff = Date.now() - lastUsed;
        if (diff < LFG_COOLDOWN_MS) {
          const remainingMinutes = Math.ceil((LFG_COOLDOWN_MS - diff) / (60 * 1000));
          return interaction.reply({
            content: `⏳ **Cooldown aktiv!** Bitte warte noch **${remainingMinutes} Minuten**, bevor du erneut nach Mitspielern suchst.`,
            flags: MessageFlags.Ephemeral
          });
        }
      }

      const allGames = await db.getAllGames();
      if (!allGames || allGames.length === 0) {
        return interaction.reply({
          content: '❌ Es sind aktuell noch keine Spiele im Katalog hinterlegt. Bitte wende dich an einen Mod oder schlage dein Spiel mit `/gamevorschlagen` vor!',
          flags: MessageFlags.Ephemeral
        });
      }

      const options = allGames.slice(0, 25).map(g => {
        return new StringSelectMenuOptionBuilder()
          .setLabel(g.name.length > 100 ? g.name.substring(0, 97) + '...' : g.name)
          .setDescription(g.platform ? `Plattform: ${g.platform}` : 'Spiel')
          .setValue(g.id.toString())
          .setEmoji('🎮');
      });

      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('lobby_select_lfg_game')
        .setPlaceholder('🎮 Wähle ein Spiel aus der Liste...')
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(options);

      const selectRow = new ActionRowBuilder().addComponents(selectMenu);

      const embed = new EmbedBuilder()
        .setTitle('📢 Mitspieler suchen')
        .setDescription(
          'Wähle unten aus der Liste das Spiel aus, für das du Mitspieler suchst.\n\n' +
          '👉 Im nächsten Schritt kannst du kurz Details zu deiner Runde angeben (z. B. Uhrzeit, Voice-Channel, Mitspieler-Anzahl).'
        )
        .setColor('#FFA500')
        .setFooter({ text: 'Nur im Katalog eingetragene Spiele können gewählt werden' });

      return interaction.reply({
        embeds: [embed],
        components: [selectRow],
        flags: MessageFlags.Ephemeral
      });
    }

    // E) LFG Suche beenden
    if (interaction.customId === 'lfg_btn_close') {
      const thread = interaction.channel;
      if (!thread || !thread.isThread()) {
        return interaction.reply({ content: '❌ Dies kann nur in einem Thread ausgeführt werden.', flags: MessageFlags.Ephemeral });
      }

      const lfgData = await db.getLfgThread(thread.id);
      const isCreator = lfgData ? lfgData.creatorId === interaction.user.id : false;
      const isAdmin = interaction.member?.permissions?.has(PermissionFlagsBits.Administrator);

      if (!isCreator && !isAdmin) {
        return interaction.reply({
          content: '❌ Nur der Ersteller dieser Suche (oder ein Admin) kann sie vorzeitig beenden!',
          flags: MessageFlags.Ephemeral
        });
      }

      await db.closeLfgThread(thread.id);
      await interaction.reply({ content: '🔒 Die Suche wurde beendet. Dieser Thread wird geschlossen.' });
      setTimeout(async () => {
        // Starter-Benachrichtigung ("the grid. started a thread: ...") im Hauptkanal löschen
        try {
          const parentChannel = thread.parent || (await interaction.client.channels.fetch(thread.parentId).catch(() => null));
          if (parentChannel) {
            const starterMsg = await parentChannel.messages.fetch(thread.id).catch(() => null);
            if (starterMsg) await starterMsg.delete().catch(() => {});
          }
        } catch (e) {}

        try {
          await thread.delete('Suche vorzeitig beendet');
        } catch (e) {
          try { await thread.setArchived(true); } catch (e2) {}
        }
      }, 3000);
      return;
    }
  }

  // --- 2. MODAL SUBMITS ---
  if (interaction.isModalSubmit()) {
    // A) Modal: Lobbycode teilen
    if (interaction.customId === 'lobby_modal_share_code') {
      const gameName = interaction.fields.getTextInputValue('lobby_input_game').trim();
      const code = interaction.fields.getTextInputValue('lobby_input_code').trim();
      const note = interaction.fields.getTextInputValue('lobby_input_note')?.trim() || '';

      const thread = await getOrCreateLobbyThread(interaction.client);
      if (!thread) {
        return interaction.reply({
          content: '❌ Fehler beim Zugriff auf den Lobbycode-Thread. Bitte kontaktiere einen Admin.',
          flags: MessageFlags.Ephemeral
        });
      }

      const expiresAt = Date.now() + CODE_EXPIRE_MS;

      const embed = new EmbedBuilder()
        .setTitle(`🔑 Lobbycode: ${gameName}`)
        .setDescription(
          `**Code / Link:**\n\`\`\`\n${code}\n\`\`\`\n` +
          (note ? `📝 **Info:** ${note}\n\n` : '') +
          `👤 **Geteilt von:** ${interaction.user} (\`${interaction.user.tag}\`)\n` +
          `⏱️ **Löschung:** In 8 Stunden automatisch`
        )
        .setColor('#FFA500')
        .setThumbnail(interaction.user.displayAvatarURL())
        .setTimestamp(expiresAt)
        .setFooter({ text: 'Gültig bis (ca.)' });

      const sentMsg = await thread.send({ embeds: [embed] });
      const targetChannelId = await getLobbyChannelId();
      await db.addLobbyCode(sentMsg.id, targetChannelId, thread.id, interaction.user.id, gameName, code, note, expiresAt);

      return interaction.reply({
        content: `✅ Dein Lobbycode für **${gameName}** wurde erfolgreich im Thread ${thread} geteilt!\nEr wird in 8 Stunden automatisch entfernt.`,
        flags: MessageFlags.Ephemeral
      });
    }

    // B) Modal: Mitspieler suchen (LFG)
    if (interaction.customId.startsWith('lobby_modal_lfg_') || interaction.customId === 'lobby_modal_lfg') {
      let finalGameName = '';
      let matchedGame = null;

      if (interaction.customId.startsWith('lobby_modal_lfg_')) {
        const gameId = parseInt(interaction.customId.replace('lobby_modal_lfg_', ''), 10);
        matchedGame = await db.getGame(gameId);
        finalGameName = matchedGame ? matchedGame.name : 'Gaming';
      } else {
        const gameInput = interaction.fields.getTextInputValue('lfg_input_game')?.trim() || '';
        const allGames = await db.getAllGames();
        matchedGame = allGames.find(g => g.name.toLowerCase() === gameInput.toLowerCase()) || 
                      allGames.find(g => g.name.toLowerCase().includes(gameInput.toLowerCase()));
        finalGameName = matchedGame ? matchedGame.name : gameInput;
      }

      const info = interaction.fields.getTextInputValue('lfg_input_info').trim();

      // Cooldown setzen (Owner überspringen)
      if (interaction.user.id !== process.env.OWNER_ID) {
        await db.setLfgCooldown(interaction.user.id, Date.now());
      }

      const targetChannelId = await getLobbyChannelId();
      const channel = await interaction.client.channels.fetch(targetChannelId).catch(() => null);
      if (!channel || !channel.isTextBased()) {
        return interaction.reply({
          content: '❌ Der LFG-Kanal konnte nicht gefunden werden.',
          flags: MessageFlags.Ephemeral
        });
      }

      const expiresAt = Date.now() + LFG_EXPIRE_MS;

      // Erstelle Thread im Channel
      const threadName = `🎯・${finalGameName.slice(0, 30)} - ${interaction.user.username.slice(0, 20)}`;
      const thread = await channel.threads.create({
        name: threadName,
        autoArchiveDuration: 1440,
        type: ChannelType.PublicThread,
        reason: `Mitspieler-Suche von ${interaction.user.tag}`
      });

      await db.addLfgThread(thread.id, targetChannelId, interaction.user.id, finalGameName, expiresAt);

      // Finde Abonnenten
      let subscribers = [];
      if (matchedGame) {
        subscribers = await db.getUsersForGame(matchedGame.id);
      }

      // Stille User (noPing === 1) ermitteln & ohne Ping zum Thread hinzufügen
      const silentUserIds = subscribers
        .filter(s => s.noPing === 1 && s.userId !== interaction.user.id)
        .map(s => s.userId);

      // User, die gepingt werden sollen (noPing === 0)
      let pingUsers = subscribers.filter(s => s.noPing === 0 && s.userId !== interaction.user.id);
      // Falls der Ersteller der einzige Abonnent ist (z. B. beim Testen):
      if (pingUsers.length === 0 && subscribers.some(s => s.noPing === 0 && s.userId === interaction.user.id)) {
        pingUsers = subscribers.filter(s => s.noPing === 0);
      }

      const lfgEmbed = new EmbedBuilder()
        .setTitle(`🎯 Mitspieler gesucht: ${finalGameName}`)
        .setDescription(
          `**Host:** ${interaction.user} (\`${interaction.user.tag}\`)\n` +
          `**Spiel:** **${finalGameName}**\n\n` +
          `📝 **Details:**\n${info}\n\n` +
          `💡 *Nutze diesen Thread, um dich mit ${interaction.user.username} abzusprechen!*\n` +
          `⏱️ *Dieser Thread schließt automatisch nach 48 Stunden.*`
        )
        .setColor('#10b981')
        .setThumbnail(interaction.user.displayAvatarURL())
        .setFooter({ text: '🫵 | the grid. Mitspieler-Suche' });

      const closeRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('lfg_btn_close')
          .setLabel('Suche beenden')
          .setEmoji('🔒')
          .setStyle(ButtonStyle.Danger)
      );

      await thread.send({ embeds: [lfgEmbed], components: [closeRow] });

      // Stille User zum Thread hinzufügen (ohne @-Ping)
      for (const sId of silentUserIds) {
        try {
          await thread.members.add(sId);
        } catch (e) {}
      }

      // Pings unter dem Embed ausführen: "ein user nach dem anderen"
      if (pingUsers.length > 0) {
        const mentionLines = pingUsers.map(s => `<@${s.userId}>`);
        let currentChunk = [];
        let currentLen = 0;
        const chunks = [];

        for (const line of mentionLines) {
          if (currentLen + line.length + 1 > 1500) {
            chunks.push(currentChunk.join('\n'));
            currentChunk = [line];
            currentLen = line.length;
          } else {
            currentChunk.push(line);
            currentLen += line.length + 1;
          }
        }
        if (currentChunk.length > 0) chunks.push(currentChunk.join('\n'));

        for (let i = 0; i < chunks.length; i++) {
          const isFirst = i === 0;
          const isLast = i === chunks.length - 1;
          let content = isFirst ? `🔔 **Lobby-Alert: Neue Runde für ${finalGameName}!**\n\n` : '';
          content += chunks[i];
          if (isLast) {
            content += `\n\nℹ️ *Aufgrund eurer Auswahl im Lobbys-Panel wurdet ihr hier benachrichtigt. Ihr könnt dort jederzeit Pings stummschalten (🔕 Kein Ping) oder Spiele entfernen.*`;
          }
          await thread.send({ content });
        }
      } else {
        await thread.send({
          content: `ℹ️ *Aktuell hat noch niemand Lobby-Alerts für **${finalGameName}** abonniert. Klicke im Hauptkanal im Panel auf „Lobby-Alerts“, um dich für dieses Spiel einzutragen!*`
        });
      }

      return interaction.reply({
        content: `✅ Dein Mitspieler-Thread wurde erfolgreich gestartet: ${thread}!\n${pingUsers.length} Spieler wurden benachrichtigt.`,
        flags: MessageFlags.Ephemeral
      });
    }
  }

  // --- 3. SELECT MENUS ---
  if (interaction.isStringSelectMenu()) {
    if (interaction.customId === 'lobby_select_lfg_game') {
      const selectedGameId = parseInt(interaction.values[0], 10);
      const game = await db.getGame(selectedGameId);
      if (!game) {
        return interaction.reply({
          content: '❌ Dieses Spiel wurde leider nicht im Katalog gefunden.',
          flags: MessageFlags.Ephemeral
        });
      }

      const modal = new ModalBuilder()
        .setCustomId(`lobby_modal_lfg_${game.id}`)
        .setTitle(`Mitspieler: ${game.name.slice(0, 30)}`);

      const infoInput = new TextInputBuilder()
        .setCustomId('lfg_input_info')
        .setLabel('Details zur Runde / Gesuchte Spieler')
        .setPlaceholder('z.B. Suchen +2 ab 20:00 Uhr, Talk 2')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(400);

      modal.addComponents(new ActionRowBuilder().addComponents(infoInput));

      return interaction.showModal(modal);
    }

    if (interaction.customId === 'lobby_select_alerts') {
      const selectedGameIds = interaction.values.map(v => parseInt(v, 10));
      const currentAlerts = await db.getUserAlerts(interaction.user.id);
      const isNoPing = await db.getUserGlobalNoPing(interaction.user.id);

      // Entferne alle alten Alerts
      for (const a of currentAlerts) {
        await db.removeUserAlert(interaction.user.id, a.gameId);
      }

      // Füge ausgewählte neu hinzu
      for (const gId of selectedGameIds) {
        await db.addUserAlert(interaction.user.id, gId, isNoPing ? 1 : 0);
      }

      return renderUserAlertsMenu(interaction, true);
    }

    if (interaction.customId === 'games_select_remove') {
      const gameIdToRemove = parseInt(interaction.values[0], 10);
      await db.removeUserAlert(interaction.user.id, gameIdToRemove);
      return renderUserAlertsMenu(interaction, true);
    }
  }
}

/**
 * Erstellt die ephemere Ansicht für die Lobby-Alerts eines Nutzers
 */
async function renderUserAlertsMenu(interaction, isUpdate = false) {
  const allGames = await db.getAllGames();
  const userAlerts = await db.getUserAlerts(interaction.user.id);
  const userGameIds = new Set(userAlerts.map(a => a.gameId));
  const isNoPing = await db.getUserGlobalNoPing(interaction.user.id);

  if (!allGames || allGames.length === 0) {
    const emptyMsg = {
      content: '❌ Es sind aktuell noch keine Spiele im Katalog hinterlegt. Moderatoren können diese im Dashboard anlegen!',
      flags: MessageFlags.Ephemeral
    };
    return isUpdate ? interaction.update(emptyMsg) : interaction.reply(emptyMsg);
  }

  const alertListText = userAlerts.length > 0
    ? userAlerts.map(a => `• **${a.gameName}** (${a.platform})`).join('\n')
    : '*Keine Spiele abonniert.*';

  const embed = new EmbedBuilder()
    .setTitle('🔔 Deine Lobby-Alerts verwalten')
    .setDescription(
      'Wähle im Menü unten aus, für welche Spiele du benachrichtigt werden möchtest, wenn ein Mitspieler eine Runde sucht!\n\n' +
      `**Deine aktuell aktiven Alerts (${userAlerts.length}):**\n${alertListText}\n\n` +
      `**Benachrichtigungs-Modus:** ${isNoPing ? '🔕 **Kein Ping** (Du wirst dem Thread still beigefügt)' : '🔔 **Ping aktiv** (Du erhältst einen Erwähnungs-Ping)'}`
    )
    .setColor('#FFA500')
    .setFooter({ text: 'Wähle bis zu 25 Spiele gleichzeitig aus' });

  // Dropdown für Spiele (bis max 25 Optionen)
  const options = allGames.slice(0, 25).map(g => {
    return new StringSelectMenuOptionBuilder()
      .setLabel(g.name.length > 100 ? g.name.substring(0, 97) + '...' : g.name)
      .setDescription(g.platform ? `Plattform: ${g.platform}` : 'Spiel')
      .setValue(g.id.toString())
      .setDefault(userGameIds.has(g.id));
  });

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('lobby_select_alerts')
    .setPlaceholder('Wähle deine Spiele aus...')
    .setMinValues(0)
    .setMaxValues(options.length)
    .addOptions(options);

  const selectRow = new ActionRowBuilder().addComponents(selectMenu);

  const toggleBtn = new ButtonBuilder()
    .setCustomId('lobby_btn_toggle_noping')
    .setLabel(isNoPing ? 'Pings aktivieren (🔔)' : 'Pings stummschalten (🔕 Kein Ping)')
    .setStyle(isNoPing ? ButtonStyle.Success : ButtonStyle.Secondary);

  const btnRow = new ActionRowBuilder().addComponents(toggleBtn);

  const responsePayload = {
    embeds: [embed],
    components: [selectRow, btnRow],
    flags: MessageFlags.Ephemeral
  };

  if (isUpdate) {
    return interaction.update(responsePayload);
  } else {
    return interaction.reply(responsePayload);
  }
}
