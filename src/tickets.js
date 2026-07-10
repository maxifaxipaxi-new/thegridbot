import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { db } from './database/database.js';
import fs from 'node:fs';
import path from 'node:path';

const TEAM_ROLE_ID = process.env.TEAM_ROLE_ID || '1294670974020616294';
const CATEGORY_ID = '1294671725606473729';
const TRANSCRIPT_CHANNEL_ID = '1387355992236363867';

export async function handleTicketSetup(interaction) {
  const member = interaction.member;
  const hasRole = member.roles.cache.has(TEAM_ROLE_ID);
  if (!hasRole && interaction.user.id !== process.env.OWNER_ID) {
    return interaction.reply({ content: '❌ Keine Berechtigung.', flags: MessageFlags.Ephemeral });
  }

  const embed = new EmbedBuilder()
    .setTitle('🎫 Support Ticket')
    .setDescription('Klicke auf den Button unten, um ein privates Ticket zu erstellen. Unser Team wird sich schnellstmöglich um dein Anliegen kümmern.')
    .setColor('#FFA500')
    .setFooter({ text: '🫵 | the grid.', iconURL: 'https://images-ext-1.discordapp.net/external/R5SJEWiQb8Qhdj8qYdHWNdhKKufBHGDAFm99OTi7WRc/https/imgur.com/p9YGWp5.png?format=webp&quality=lossless' });

  const row = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('ticket_create')
        .setLabel('Ticket erstellen')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('🎫')
    );

  await interaction.channel.send({ embeds: [embed], components: [row] });
  await interaction.reply({ content: '✅ Ticket-Panel erfolgreich erstellt.', flags: MessageFlags.Ephemeral });
}

export async function deleteTicketChannel(channel, closedByTag, client) {
  let transcriptText = `Transkript für Kanal ${channel.name}\nErstellt am: ${new Date().toLocaleString('de-DE')}\n\n`;
  try {
    const messages = await channel.messages.fetch({ limit: 100 });
    const sortedMessages = Array.from(messages.values()).reverse();
    
    for (const msg of sortedMessages) {
      if (msg.author.bot && msg.embeds.length > 0) {
         transcriptText += `[${new Date(msg.createdTimestamp).toLocaleString('de-DE')}] ${msg.author.tag}: [Embed Message]\n`;
      } else {
         transcriptText += `[${new Date(msg.createdTimestamp).toLocaleString('de-DE')}] ${msg.author.tag}: ${msg.content}\n`;
      }
    }
  } catch (err) {
    transcriptText += "Fehler beim Laden der Nachrichten.\n";
  }
  
  const tempPath = path.join(process.cwd(), `${channel.name}-transcript.txt`);
  fs.writeFileSync(tempPath, transcriptText);
  
  const logChannel = await client.channels.fetch(TRANSCRIPT_CHANNEL_ID).catch(() => null);
  if (logChannel) {
    await logChannel.send({
      content: `Transkript für **${channel.name}** (Geschlossen von ${closedByTag})`,
      files: [tempPath]
    }).catch(() => {});
  }
  
  fs.unlinkSync(tempPath);
  
  await db.deleteTicket(channel.id);
  await channel.delete().catch(() => {});
}

export async function handleTicketButton(interaction) {
  const { customId, guild, user, channel } = interaction;

  if (customId === 'ticket_create') {
    const allTickets = await db.getTickets();
    const hasOpenTicket = Object.values(allTickets).some(
      t => t.userId === user.id && t.status === 'open'
    );

    if (hasOpenTicket) {
      return interaction.reply({ content: '❌ Du hast bereits ein offenes Ticket. Bitte schließe dieses zuerst.', flags: MessageFlags.Ephemeral });
    }

    const ticketName = `ticket-${user.username}`;

    try {
      const newChannel = await guild.channels.create({
        name: ticketName,
        type: ChannelType.GuildText,
        parent: CATEGORY_ID,
        permissionOverwrites: [
          {
            id: guild.id,
            deny: [PermissionFlagsBits.ViewChannel],
          },
          {
            id: user.id,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
          },
          {
            id: TEAM_ROLE_ID,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
          },
        ],
      });

      await db.createTicket(newChannel.id, user.id, user.username);

      const welcomeEmbed = new EmbedBuilder()
        .setTitle('🎫 Ticket eröffnet')
        .setDescription(`Willkommen im Support, ${user}! Bitte beschreibe dein Anliegen.\nEin Team-Mitglied wird dir bald antworten.`)
        .setColor('#FFA500')
        .setFooter({ text: '🫵 | the grid.', iconURL: 'https://images-ext-1.discordapp.net/external/R5SJEWiQb8Qhdj8qYdHWNdhKKufBHGDAFm99OTi7WRc/https/imgur.com/p9YGWp5.png?format=webp&quality=lossless' });

      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId('ticket_close')
            .setLabel('Ticket schließen')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('🔒')
        );

      await newChannel.send({ content: `${user}`, embeds: [welcomeEmbed], components: [row] });
      await interaction.reply({ content: `✅ Dein Ticket wurde erstellt: ${newChannel}`, flags: MessageFlags.Ephemeral });
    } catch (err) {
      console.error('Fehler beim Erstellen des Tickets:', err);
      await interaction.reply({ content: '❌ Fehler beim Erstellen des Tickets. Bitte einen Admin kontaktieren.', flags: MessageFlags.Ephemeral });
    }
  }
  else if (customId === 'ticket_close') {
    const isMod = interaction.member.roles.cache.has(TEAM_ROLE_ID) || user.id === process.env.OWNER_ID;
    const ticketData = (await db.getTickets())[channel.id];

    if (!ticketData) {
      return interaction.reply({ content: '❌ Dieses Ticket existiert nicht in der Datenbank.', flags: MessageFlags.Ephemeral });
    }

    if (!isMod && ticketData.userId !== user.id) {
      return interaction.reply({ content: '❌ Du darfst dieses Ticket nicht schließen.', flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply();
    
    // Entziehe dem Ersteller die Schreibrechte
    await channel.permissionOverwrites.edit(ticketData.userId, { SendMessages: false });
    await db.closeTicket(channel.id);

    const closeEmbed = new EmbedBuilder()
      .setDescription(`🔒 Dieses Ticket wurde von ${user} geschlossen. Es kann nun von einem Moderator gelöscht werden.`)
      .setColor('#ef4444');

    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('ticket_reopen')
          .setLabel('Ticket wieder öffnen')
          .setStyle(ButtonStyle.Success)
          .setEmoji('🔓'),
        new ButtonBuilder()
          .setCustomId('ticket_delete')
          .setLabel('Ticket löschen')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('🗑️')
      );

    await interaction.followUp({ embeds: [closeEmbed], components: [row] });
  }
  else if (customId === 'ticket_reopen') {
    const isMod = interaction.member.roles.cache.has(TEAM_ROLE_ID) || user.id === process.env.OWNER_ID;
    if (!isMod) {
      return interaction.reply({ content: '❌ Nur Moderatoren dürfen Tickets wieder öffnen.', flags: MessageFlags.Ephemeral });
    }

    const ticketData = (await db.getTickets())[channel.id];
    if (!ticketData) {
      return interaction.reply({ content: '❌ Dieses Ticket existiert nicht in der Datenbank.', flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply();
    
    // Gib dem Ersteller die Schreibrechte zurück
    await channel.permissionOverwrites.edit(ticketData.userId, { SendMessages: true });
    await db.reopenTicket(channel.id);

    const reopenEmbed = new EmbedBuilder()
      .setDescription(`🔓 Dieses Ticket wurde von Moderator ${user} wieder geöffnet.`)
      .setColor('#10b981');

    await interaction.followUp({ embeds: [reopenEmbed] });
  }
  else if (customId === 'ticket_delete') {
    const isMod = interaction.member.roles.cache.has(TEAM_ROLE_ID) || user.id === process.env.OWNER_ID;
    if (!isMod) {
      return interaction.reply({ content: '❌ Nur Moderatoren dürfen Tickets löschen.', flags: MessageFlags.Ephemeral });
    }

    await interaction.reply('🗑️ Ticket wird gelöscht... Generiere Transkript.');
    await deleteTicketChannel(channel, user.tag, interaction.client);
  }
}
