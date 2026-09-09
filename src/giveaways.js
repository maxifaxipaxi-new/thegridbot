import { EmbedBuilder } from 'discord.js';
import { db } from './database/database.js';

export function startGiveawayScheduler(client) {
  // Check giveaways every minute
  setInterval(async () => {
    try {
      const activeGiveaways = await db.getActiveGiveaways();
      const now = Date.now();

      for (const giveaway of activeGiveaways) {
        if (now >= giveaway.endsAt) {
          await endGiveaway(client, giveaway);
        }
      }
    } catch (err) {
      console.error('Fehler im Giveaway Scheduler:', err);
    }
  }, 60 * 1000);
}

export async function endGiveaway(client, giveaway) {
  try {
    // 1. Mark as ended in DB
    await db.endGiveaway(giveaway.id);

    // 2. Fetch Entries
    const entries = await db.getGiveawayEntries(giveaway.id);
    
    let winners = [];
    if (entries.length > 0) {
      // Pick random winners
      const shuffled = entries.sort(() => 0.5 - Math.random());
      winners = shuffled.slice(0, giveaway.winnerCount);
    }

    // 3. Edit original message
    const channel = client.channels.cache.get(giveaway.channelId);
    if (channel && giveaway.messageId !== 'pending') {
      try {
        const message = await channel.messages.fetch(giveaway.messageId);
        
        let desc = giveaway.description;
        if (giveaway.hostedBy) desc += `\n\n**Gestiftet von:** ${giveaway.hostedBy}`;
        
        let winnerText = '';
        if (winners.length > 0) {
           winnerText = winners.map(w => `<@${w}>`).join(', ');
        } else {
           winnerText = 'Keine Teilnehmer';
        }
        desc += `\n\n🏆 **GEWINNER:** ${winnerText}`;

        const embed = new EmbedBuilder()
          .setTitle(`🎉 [BEENDET] ${giveaway.title}`)
          .setDescription(desc)
          .setColor('#4b5563'); // gray out

        if (giveaway.banner) embed.setImage(giveaway.banner);

        await message.edit({ embeds: [embed], components: [] });
      } catch (err) {
        console.error(`Konnte Giveaway-Nachricht nicht editieren (Giveaway ${giveaway.id}):`, err);
      }
    }

    // 4. DM Winners
    for (const winnerId of winners) {
      try {
        const user = await client.users.fetch(winnerId);
        if (user) {
          const dmEmbed = new EmbedBuilder()
            .setTitle('🎉 DU HAST GEWONNEN! 🎉')
            .setDescription(`Herzlichen Glückwunsch!\nDu bist einer der glücklichen Gewinner von **${giveaway.title}**!\n\nUm deinen Gewinn zu erhalten, öffne bitte ein **Ticket** auf unserem Discord Server!`)
            .setColor('#10b981')
            .setFooter({ text: 'the grid.' });
          
          await user.send({ embeds: [dmEmbed] });
        }
      } catch (err) {
        console.error(`Konnte DM an Gewinner ${winnerId} nicht senden:`, err);
      }
    }

  } catch (err) {
    console.error(`Fehler beim Beenden von Giveaway ${giveaway.id}:`, err);
  }
}
