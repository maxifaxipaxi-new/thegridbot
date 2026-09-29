import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

const WAITING_ROOM_ID = '1520836376927666198';
const TARGET_ROOM_ID = '1342980740933226527';
const NOTIFICATION_CHANNEL_ID = '1527613425788784740';

export async function handleWaitingRoomJoin(oldState, newState) {
  // Wenn der Nutzer den Voice Channel verlässt oder der Channel sich nicht ändert
  if (!newState.channelId || oldState.channelId === newState.channelId) return;

  // Nur den spezifischen Radio/Music Bot (1522221672848035870) ignorieren
  if (newState.member.id === '1522221672848035870') return;


  // Prüfen, ob der neue Channel der Warteraum ist
  if (newState.channelId === WAITING_ROOM_ID) {
    const guild = newState.guild;
    const targetChannel = guild.channels.cache.get(TARGET_ROOM_ID);
    const notificationChannel = guild.channels.cache.get(NOTIFICATION_CHANNEL_ID);

    if (!targetChannel) {
      return;
    }
    if (!notificationChannel) {
      return;
    }

    // Aktuelle Voice States in der Gilde prüfen (als Fallback, falls channel.members nicht greift)
    const voiceStatesInTarget = guild.voiceStates.cache.filter(vs => vs.channelId === TARGET_ROOM_ID);
    

    // Wir ignorieren nur den explizit genannten Bot (1522221672848035870)
    const hasHumanInTarget = voiceStatesInTarget.some(vs => vs.id !== '1522221672848035870');

    if (hasHumanInTarget) {
      const embed = new EmbedBuilder()
        .setTitle('⏳ Jemand wartet!')
        .setDescription(`**${newState.member.user.username}** wartet im Warteraum (<#${WAITING_ROOM_ID}>).`)
        .setColor('#FFA500')
        .setThumbnail(newState.member.user.displayAvatarURL())
        .setFooter({ text: 'Klicke auf den Button, um den Nutzer reinzuziehen.' });

      const button = new ButtonBuilder()
        .setCustomId(`move_waiter_${newState.member.id}`)
        .setLabel(`${newState.member.user.username} reinziehen`)
        .setEmoji('👋')
        .setStyle(ButtonStyle.Success);

      const actionRow = new ActionRowBuilder().addComponents(button);

      // Nachricht in den Notification-Channel senden (ohne @mention)
      await notificationChannel.send({ embeds: [embed], components: [actionRow] });
    }
  }
}

export async function handleWaitingRoomButton(interaction) {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith('move_waiter_')) return;

  const targetUserId = interaction.customId.replace('move_waiter_', '');
  const guild = interaction.guild;
  
  try {
    const targetMember = await guild.members.fetch(targetUserId);

    // Prüfen, ob der Nutzer noch im Warteraum ist
    if (!targetMember.voice.channelId || targetMember.voice.channelId !== WAITING_ROOM_ID) {
      const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
        .setDescription(`Der Nutzer **${targetMember.user.username}** ist nicht mehr im Warteraum.`)
        .setColor('#808080');
      
      await interaction.update({ embeds: [updatedEmbed], components: [] });
      return;
    }

    // Nutzer verschieben
    await targetMember.voice.setChannel(TARGET_ROOM_ID);

    const updatedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
        .setDescription(`✅ **${targetMember.user.username}** wurde von **${interaction.user.username}** in den Ziel-Channel gezogen.`)
        .setColor('#10b981');

    await interaction.update({ embeds: [updatedEmbed], components: [] });

  } catch (err) {
    console.error('Fehler beim Verschieben aus dem Warteraum:', err);
    await interaction.reply({ content: 'Der Nutzer konnte nicht verschoben werden. (Eventuell hat er den Server verlassen).', ephemeral: true });
  }
}
