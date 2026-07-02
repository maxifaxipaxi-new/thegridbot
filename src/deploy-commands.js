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
].map(command => command.toJSON());

if (!process.env.DISCORD_TOKEN || !process.env.CLIENT_ID) {
  console.error('Fehler: DISCORD_TOKEN oder CLIENT_ID fehlt in der .env Datei.');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
const GUILD_ID = '1294669609349283925'; // Gilden-ID für sofortiges Update

(async () => {
  try {
    console.log(`Starte Registrierung von ${commands.length} Slash-Commands...`);

    // 1. Globale Commands aktualisieren
    const globalData = await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands }
    );
    console.log(`Erfolgreich ${globalData.length} globale Slash-Commands registriert!`);

    // 2. Gilden-spezifische Commands bereinigen (leeres Array senden, um Duplikate zu vermeiden)
    const guildData = await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, GUILD_ID),
      { body: [] }
    );
    console.log(`Gilden-Slash-Commands für Gilde ${GUILD_ID} erfolgreich gelöscht (um Duplikate zu vermeiden).`);
  } catch (error) {
    console.error('Fehler bei der Registrierung der Slash-Commands:', error);
  }
})();
