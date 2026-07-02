import cron from 'node-cron';
import { EmbedBuilder } from 'discord.js';
import { db } from './database/database.js';

export function startBirthdayScheduler(client) {
  // Cron-Job: Täglich um 00:00 Uhr nach deutscher Zeit
  cron.schedule('0 0 * * *', () => {
    console.log('Führe täglichen Geburtstags-Check aus...');
    checkBirthdays(client);
  }, {
    scheduled: true,
    timezone: 'Europe/Berlin'
  });

  // Initialer Check direkt beim Starten des Bots
  console.log('Initialer Geburtstags-Check bei Bot-Start...');
  checkBirthdays(client);
}

export async function checkBirthdays(client) {
  try {
    const today = new Date();
    // Umwandlung in die europäische Zeitzone für Konsistenz bei Tag und Monat
    const formatter = new Intl.DateTimeFormat('de-DE', {
      timeZone: 'Europe/Berlin',
      day: 'numeric',
      month: 'numeric'
    });
    const parts = formatter.formatToParts(today);
    const day = parseInt(parts.find(p => p.type === 'day').value, 10);
    const month = parseInt(parts.find(p => p.type === 'month').value, 10);

    console.log(`Prüfe Geburtstage für das Datum: ${day}.${month}.`);

    const birthdayUserIds = await db.getUsersWithBirthdayToday(day, month);
    if (birthdayUserIds.length === 0) {
      console.log('Keine Mitglieder haben heute Geburtstag.');
      return;
    }

    const guilds = await db.getAllGuildConfigs();

    for (const [guildId, config] of Object.entries(guilds)) {
      const channelId = config.birthdayChannelId;
      if (!channelId) continue;

      try {
        const guild = await client.guilds.fetch(guildId).catch(() => null);
        if (!guild) continue;

        const channel = await guild.channels.fetch(channelId).catch(() => null);
        if (!channel) {
          console.warn(`Geburtstagskanal mit ID ${channelId} wurde in Gilde ${guild.name} nicht gefunden.`);
          continue;
        }

        // Prüfe, welche Geburtstagskinder auf diesem Server sind
        const guildBirthdays = [];
        for (const userId of birthdayUserIds) {
          try {
            const member = await guild.members.fetch(userId);
            if (member) {
              guildBirthdays.push(member);
            }
          } catch {
            // Mitglied ist nicht auf diesem Server
          }
        }

        if (guildBirthdays.length === 0) continue;

        const mentions = guildBirthdays.map(m => `<@${m.id}>`).join(' ');
        const namesList = guildBirthdays.map(m => `• **${m.displayName}**`).join('\n');

        const embed = new EmbedBuilder()
          .setTitle('🎉 Alles Gute zum Geburtstag! 🎂')
          .setDescription(
            `Wir wünschen unseren heutigen Geburtstagskindern einen fantastischen Tag voller Freude, Spaß und natürlich Kuchen! 🎈🎁\n\n` +
            `Lasst uns heute gemeinsam feiern!\n\n` +
            `Herzlichen Glückwunsch an:\n${namesList}`
          )
          .setColor('#FFA500') // Orange für das Server-Design
          .setThumbnail(guild.iconURL({ dynamic: true }) || 'https://cdn.discordapp.com/embed/avatars/0.png')
          .setTimestamp()
          .setFooter({ 
            text: '🫵 | the grid.', 
            iconURL: 'https://images-ext-1.discordapp.net/external/R5SJEWiQb8Qhdj8qYdHWNdhKKufBHGDAFm99OTi7WRc/https/imgur.com/p9YGWp5.png?format=webp&quality=lossless'
          });

        await channel.send({
          content: `Herzlichen Glückwunsch! 🥂 ${mentions}`,
          embeds: [embed]
        });

        console.log(`Geburtstags-Embed erfolgreich an Gilde ${guild.name} (#${channel.name}) gesendet für: ${guildBirthdays.map(m => m.user.tag).join(', ')}`);
      } catch (err) {
        console.error(`Fehler beim Senden der Geburtstagsgrüße in Gilde ${guildId}:`, err);
      }
    }
  } catch (error) {
    console.error('Genereller Fehler im Birthday-Scheduler:', error);
  }
}
