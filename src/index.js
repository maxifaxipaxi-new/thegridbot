import { Client, GatewayIntentBits, EmbedBuilder, PermissionFlagsBits, ActivityType } from 'discord.js';
import dotenv from 'dotenv';
import { db } from './database/database.js';
import { startBirthdayScheduler } from './scheduler.js';
import { startDashboard } from './dashboard/server.js';
import { startAnnouncementsScheduler } from './announcements.js';

dotenv.config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

const PREFIX = '?';

client.on('ready', () => {
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

  // Starte den Announcements-Scheduler
  startAnnouncementsScheduler(client);
});

// Event-Handler für Prefix-Commands (?message und ?embed)
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
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
        iconURL: 'https://images-ext-1.discordapp.net/external/R5SJEWiQb8Qhdj8qYdHWNdhKKufBHGDAFm99OTi7WRc/https/imgur.com/p9YGWp5.png?format=webp&quality=lossless'
      });

    await message.channel.send({ embeds: [embed] }).catch(err => {
      console.error('Fehler beim Senden des Embeds:', err);
    });
  }
});

// Event-Handler für Slash-Commands
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  try {
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
          iconURL: 'https://images-ext-1.discordapp.net/external/R5SJEWiQb8Qhdj8qYdHWNdhKKufBHGDAFm99OTi7WRc/https/imgur.com/p9YGWp5.png?format=webp&quality=lossless'
        });

      await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // /help
    else if (commandName === 'help') {
      const embed = new EmbedBuilder()
        .setTitle('📚 Bot Befehlsübersicht')
        .setDescription('Hier findest du alle verfügbaren Befehle dieses Bots:')
        .addFields(
          { 
            name: '✍️ Prefix-Befehle (im Chat schreiben)', 
            value: '`?message <Nachricht>` - Sendet eine normale Nachricht als Bot.\n`?embed <Nachricht>` - Sendet ein schickes Embed mit deinem Text.' 
          },
          { 
            name: '🚀 Slash-Befehle (mit / ausführen)', 
            value: '`/help` - Zeigt diese Hilfe-Übersicht.\n' +
                  '`/support` - Zeigt Support-Kontaktinfos (nur für dich sichtbar).\n' +
                  '`/geburtstag <tag> <monat>` - Trage deinen Geburtstag ein.\n' +
                  '`/datenschutz` - Zeigt die Datenschutzerklärung (nur für dich sichtbar).\n' +
                  '`/datenloeschung` - Löscht alle deine personenbezogenen Daten aus der Datenbank (nur für dich sichtbar).' 
          }
        )
        .setColor('#FFA500') // Orange für das Server-Design
        .setTimestamp()
        .setFooter({ 
          text: '🫵 | the grid.', 
          iconURL: 'https://images-ext-1.discordapp.net/external/R5SJEWiQb8Qhdj8qYdHWNdhKKufBHGDAFm99OTi7WRc/https/imgur.com/p9YGWp5.png?format=webp&quality=lossless'
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
          ephemeral: true 
        });
      }

      await db.setUserBirthday(interaction.user.id, tag, monat);

      await interaction.reply({
        content: `🎉 Dein Geburtstag wurde erfolgreich auf den **${tag}.${monat}.** festgelegt! Ich werde dir an diesem Tag gratulieren.`,
        ephemeral: true
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
          '• **Discord-User-ID:** Zur eindeutigen Zuordnung von Geburtstagen zu deinem Discord-Konto.\n' +
          '• **Geburtstag (Tag & Monat):** Um automatische Glückwünsche am Geburtstag im konfigurierten Kanal zu senden.\n' +
          '• **Gilden-ID & Kanal-ID:** Zur Speicherung der Server-Konfiguration (in welchem Kanal Glückwünsche gesendet werden sollen).\n\n' +
          '*Rechtsgrundlage:* Die Verarbeitung erfolgt auf Grundlage deiner ausdrücklichen Einwilligung (**Art. 6 Abs. 1 lit. a DSGVO**) durch die freiwillige Eingabe deines Geburtstags über den Befehl `/geburtstag`.\n\n' +
          '### 3. Datenspeicherung & Sicherheit\n' +
          '• Alle Daten werden lokal in einer sicheren JSON-Datei (`db.json`) auf dem Server des Bot-Betreibers in Deutschland gespeichert.\n' +
          '• Es erfolgt **keine Weitergabe** der Daten an Dritte.\n' +
          '• Es werden **keine** Chatnachrichten, IP-Adressen, Profile oder sonstige Metadaten dauerhaft protokolliert.\n\n' +
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
          iconURL: 'https://images-ext-1.discordapp.net/external/R5SJEWiQb8Qhdj8qYdHWNdhKKufBHGDAFm99OTi7WRc/https/imgur.com/p9YGWp5.png?format=webp&quality=lossless'
        });

      await interaction.reply({ embeds: [embed], ephemeral: true });
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
          iconURL: 'https://images-ext-1.discordapp.net/external/R5SJEWiQb8Qhdj8qYdHWNdhKKufBHGDAFm99OTi7WRc/https/imgur.com/p9YGWp5.png?format=webp&quality=lossless'
        });

      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
  } catch (error) {
    console.error(`Fehler bei Interaktion ${commandName}:`, error);
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content: 'Bei der Ausführung dieses Befehls ist ein Fehler aufgetreten!', ephemeral: true });
      } else {
        await interaction.reply({ content: 'Bei der Ausführung dieses Befehls ist ein Fehler aufgetreten!', ephemeral: true });
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
