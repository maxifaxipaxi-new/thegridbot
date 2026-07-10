import { ChannelType } from 'discord.js';

export function startAutoDeleteScheduler(client) {
  const CHANNEL_ID = '1519069474559496202';
  const EIGHT_HOURS = 8 * 60 * 60 * 1000;

  // Prüfe alle 10 Minuten
  setInterval(async () => {
    try {
      const channel = await client.channels.fetch(CHANNEL_ID).catch(() => null);
      if (!channel || channel.type !== ChannelType.GuildText) return;

      const now = Date.now();
      let lastId;
      let hasMore = true;

      while (hasMore) {
        const options = { limit: 100 };
        if (lastId) options.before = lastId;

        const messages = await channel.messages.fetch(options).catch(() => null);
        if (!messages || messages.size === 0) {
          hasMore = false;
          break;
        }

        const toDelete = messages.filter(msg => {
          // Angepinnte Nachrichten nicht löschen
          if (msg.pinned) return false;
          // Alter der Nachricht prüfen (älter als 8 Stunden?)
          const age = now - msg.createdTimestamp;
          return age > EIGHT_HOURS;
        });

        if (toDelete.size > 0) {
          // bulkDelete funktioniert nur für Nachrichten, die jünger als 14 Tage sind.
          // Da wir nach 8 Stunden löschen, ist das kein Problem.
          await channel.bulkDelete(toDelete, true).catch(err => {
            console.error('Fehler beim Löschen der Nachrichten im Codes-Channel:', err);
          });
        }

        lastId = messages.last().id;
        
        // Wenn wir weniger als 100 Nachrichten erhalten haben, sind wir am Ende
        if (messages.size < 100) {
          hasMore = false;
        }
      }
    } catch (error) {
      console.error('Fehler beim Auto-Delete Scheduler (Codes Channel):', error);
    }
  }, 10 * 60 * 1000); // Alle 10 Minuten
}
