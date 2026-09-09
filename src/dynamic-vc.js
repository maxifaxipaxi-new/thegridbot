import { ChannelType, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { db } from './database/database.js';

const TARGET_VC_ID = '1294684126938660894';

export function setupDynamicVCs(client) {
  client.on('voiceStateUpdate', async (oldState, newState) => {
    // 1. User joined the target VC
    if (newState.channelId === TARGET_VC_ID && newState.member) {
      try {
        const guild = newState.guild;
        const categoryId = newState.channel.parentId;
        const member = newState.member;

        // Create the new channel in the same category
        const newChannel = await guild.channels.create({
          name: `📞│ Quatschen - ${member.user.username}`,
          type: ChannelType.GuildVoice,
          parent: categoryId,
        });

        // Save channel and owner in DB
        await db.addDynamicChannel(newChannel.id, member.id);

        // Move member to the new channel
        await member.voice.setChannel(newChannel);

        // Send embed to the voice channel's text chat
        const embed = new EmbedBuilder()
          .setTitle('⚙️ Dein temporärer Voice-Channel')
          .setDescription(`Willkommen in deinem eigenen Voice-Channel, ${member}!\n\nNutze die Buttons unten, um deinen Kanal zu verwalten:`)
          .setColor('#FFA500')
          .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('vc_rename')
            .setLabel('Umbenennen')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('✏️'),
          new ButtonBuilder()
            .setCustomId('vc_limit')
            .setLabel('Limit setzen')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('👥'),
          new ButtonBuilder()
            .setCustomId('vc_lock')
            .setLabel('Sperren')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('🔒'),
          new ButtonBuilder()
            .setCustomId('vc_unlock')
            .setLabel('Entsperren')
            .setStyle(ButtonStyle.Success)
            .setEmoji('🔓')
        );

        // Mention the user so they see it
        await newChannel.send({ content: `${member}`, embeds: [embed], components: [row] });

      } catch (err) {
        console.error('Fehler beim Erstellen des dynamischen Voice-Channels:', err);
      }
    }

    // 2. User left or moved from a channel
    if (oldState.channelId && oldState.channelId !== newState.channelId) {
      try {
        const channel = oldState.channel;
        if (!channel) return;

        // Check if it's a dynamic channel registered in DB
        const isDynamic = await db.isDynamicChannel(channel.id);
        
        if (isDynamic) {
          // If empty, delete it
          if (channel.members.size === 0) {
            await channel.delete('Dynamischer Voice-Channel war leer.');
            await db.removeDynamicChannel(channel.id);
          }
        }
      } catch (err) {
        console.error('Fehler beim Löschen des dynamischen Voice-Channels (evtl. schon gelöscht):', err);
        // Also cleanup DB just in case the channel was manually deleted
        if (oldState.channelId) {
          await db.removeDynamicChannel(oldState.channelId);
        }
      }
    }
  });
}
