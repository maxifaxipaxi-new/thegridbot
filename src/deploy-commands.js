import { REST, Routes, SlashCommandBuilder, ChannelType } from 'discord.js';
import dotenv from 'dotenv';

dotenv.config();

const commands = [
  new SlashCommandBuilder()
    .setName('support')
    .setDescription('Erhalte Support-Informationen (nur für dich sichtbar).'),

  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Zeigt eine Liste aller verfügbaren Befehle.'),

  new SlashCommandBuilder()
    .setName('weekly')
    .setDescription('Hol dir deinen wöchentlichen 100 XP Bonus ab! (Alle 7 Tage möglich)'),

  new SlashCommandBuilder()
    .setName('regeln')
    .setDescription('Zeigt einen wichtigen Hinweis zu den Server-Regeln.'),

  new SlashCommandBuilder()
    .setName('dashboard')
    .setDescription('Zeigt den Link zum Bot-Dashboard (Nur für Teammitglieder).'),

  new SlashCommandBuilder()
    .setName('streamer')
    .setDescription('Informationen für Content Creator & Streamer bezüglich Kooperationen.'),

  new SlashCommandBuilder()
    .setName('level')
    .setDescription('Zeigt dein aktuelles Level und XP an.'),

  new SlashCommandBuilder()
    .setName('top')
    .setDescription('Zeigt die Top 10 aktivsten User auf dem Server an.'),

  new SlashCommandBuilder()
    .setName('redeem')
    .setDescription('Löse einen aktiven XP-Code aus dem Stream ein.')
    .addStringOption(option =>
      option.setName('code')
        .setDescription('Der Code aus dem Stream')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('admincreate-selfroles')
    .setDescription('Erstellt das Self-Role Dropdown-Menü im aktuellen Kanal (Nur Admins).'),

  new SlashCommandBuilder()
    .setName('partner')
    .setDescription('Erfahre mehr über unsere offiziellen Partner & Kooperationen!'),

  new SlashCommandBuilder()
    .setName('gameslist')
    .setDescription('Zeigt alle verfügbaren Spiele an, für die Lobby-Alerts existieren.'),

  new SlashCommandBuilder()
    .setName('gamevorschlagen')
    .setDescription('Schlage ein neues Spiel für die Lobby-Alerts vor.')
    .addStringOption(option =>
      option.setName('name')
        .setDescription('Der genaue Name des Spiels (wie auf Steam/Epic/EA)')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('plattform')
        .setDescription('Plattform (z.B. Steam, Epic, EA, Ubisoft, Crossplay)')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('games')
    .setDescription('Zeigt deine oder die abonnierten Spiele eines anderen Users an.')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('Der User, dessen Spiele du einsehen möchtest (optional)')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('servers')
    .setDescription('Zeigt alle offiziellen Gameserver der Community, Online-Status & Laufzeiten an.'),

  new SlashCommandBuilder()
    .setName('server')
    .setDescription('Zeigt alle offiziellen Gameserver der Community, Online-Status & Laufzeiten an.'),
].map(command => command.toJSON());

if (!process.env.DISCORD_TOKEN || !process.env.DISCORD_CLIENT_ID) {
  console.error('Fehler: DISCORD_TOKEN oder DISCORD_CLIENT_ID fehlt in der .env Datei.');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
const GUILD_ID = '1294669609349283925'; // Gilden-ID für sofortiges Update

(async () => {
  try {
    console.log(`Starte Registrierung von ${commands.length} Slash-Commands...`);

    // 1. Gilden-spezifische Commands aktualisieren (sofortiges Update)
    const guildData = await rest.put(
      Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, GUILD_ID),
      { body: commands }
    );
    console.log(`Erfolgreich ${guildData.length} Gilden-Slash-Commands für Gilde ${GUILD_ID} registriert (für sofortige Sichtbarkeit)!`);

    // 2. Globale Commands bereinigen (leeres Array senden, um Duplikate zu vermeiden)
    const globalData = await rest.put(
      Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
      { body: [] }
    );
    console.log(`Globale Slash-Commands erfolgreich gelöscht.`);
  } catch (error) {
    console.error('Fehler bei der Registrierung der Slash-Commands:', error);
  }
})();
