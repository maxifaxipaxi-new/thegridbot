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
    .setName('geburtstag')
    .setDescription('Trage deinen Geburtstag ein, um an dem Tag beglückwünscht zu werden.')
    .addIntegerOption(option =>
      option.setName('tag')
        .setDescription('Der Tag deines Geburtstags (1-31)')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(31)
    )
    .addIntegerOption(option =>
      option.setName('monat')
        .setDescription('Der Monat deines Geburtstags (1-12)')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(12)
    ),

  new SlashCommandBuilder()
    .setName('datenschutz')
    .setDescription('Zeigt die Datenschutzerklärung des Bots (DSGVO-konform).'),

  new SlashCommandBuilder()
    .setName('datenloeschung')
    .setDescription('Löscht all deine gespeicherten personenbezogenen Daten aus dem Bot-System (DSGVO-konform).'),

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
    .setName('vc-rename')
    .setDescription('Benennt deinen temporären Voice-Channel um.')
    .addStringOption(option =>
      option.setName('name')
        .setDescription('Der neue Name des Channels')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('vc-limit')
    .setDescription('Setzt ein Nutzerlimit für deinen temporären Voice-Channel.')
    .addIntegerOption(option =>
      option.setName('anzahl')
        .setDescription('Maximale Anzahl an Nutzern (0 für unbegrenzt)')
        .setRequired(true)
        .setMinValue(0)
        .setMaxValue(99)
    ),

  new SlashCommandBuilder()
    .setName('vc-lock')
    .setDescription('Sperrt deinen temporären Voice-Channel für neue Nutzer.'),

  new SlashCommandBuilder()
    .setName('vc-unlock')
    .setDescription('Entsperrt deinen temporären Voice-Channel wieder.'),

  new SlashCommandBuilder()
    .setName('ticketsetup')
    .setDescription('Erstellt das Ticket-Panel im aktuellen Kanal (Nur für Moderatoren).')
    .setDefaultMemberPermissions(0), // requires admin/mod perms implicitly, but we also check role inside

  new SlashCommandBuilder()
    .setName('level')
    .setDescription('Zeigt dein aktuelles Level und XP an.'),

  new SlashCommandBuilder()
    .setName('top')
    .setDescription('Zeigt die Top 10 aktivsten User auf dem Server an.'),
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
