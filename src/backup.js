import cron from 'node-cron';
import { AttachmentBuilder } from 'discord.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, 'database', 'db.json');

async function sendBackup(client, isInitial = false) {
  try {
    const channelId = '1526270104646586498';
    const channel = await client.channels.fetch(channelId);
    
    if (channel && channel.isTextBased()) {
      const dateStr = new Date().toISOString().split('T')[0];
      const attachment = new AttachmentBuilder(dbPath, { name: `db-backup-${dateStr}.json` });
      
      const title = isInitial ? '🔄 **Datenbank-Backup bei Bot-Start**' : '💾 **Tägliches Datenbank-Backup**';
      
      await channel.send({
        content: `${title} (${dateStr})`,
        files: [attachment]
      });
      console.log(`DB-Backup erfolgreich gesendet (${isInitial ? 'Startup' : 'Täglich'}).`);
    }
  } catch (err) {
    console.error('Fehler beim Senden des DB-Backups:', err);
  }
}

export function startBackupScheduler(client) {
  // Sende Backup sofort beim Start
  sendBackup(client, true);

  // Sende Backup jeden Tag um 00:00 Uhr
  cron.schedule('0 0 * * *', () => {
    sendBackup(client, false);
  });

  console.log('Backup Scheduler gestartet (täglich um 00:00 Uhr).');
}
