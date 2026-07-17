import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  getVoiceConnection
} from '@discordjs/voice';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const audioPath = path.join(__dirname, 'assets', 'thegrid.mp3');

// Map to keep track of active audio players per guild
const audioPlayers = new Map();

export async function startRadio(client, guildId, channelId) {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;

  const channel = guild.channels.cache.get(channelId);
  if (!channel || !channel.isVoiceBased()) return;

  // Join the voice channel
  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
  });

  // Create an audio player if not exists
  let player = audioPlayers.get(guildId);
  if (!player) {
    player = createAudioPlayer();
    audioPlayers.set(guildId, player);

    // Setup looping when the track finishes
    player.on(AudioPlayerStatus.Idle, () => {
      playResource(player);
    });

    player.on('error', error => {
      console.error(`Audio Player Error in guild ${guildId}:`, error.message);
      // Try to restart after error
      setTimeout(() => playResource(player), 1000);
    });
  }

  // Subscribe connection to the player
  connection.subscribe(player);

  // Initial play
  if (player.state.status !== AudioPlayerStatus.Playing) {
    playResource(player);
  }

  // Auto-reconnect logic if disconnected unexpectedly
  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([
        new Promise(resolve => connection.once(VoiceConnectionStatus.Signalling, resolve)),
        new Promise(resolve => connection.once(VoiceConnectionStatus.Connecting, resolve)),
      ]);
      // Reconnected successfully
    } catch (error) {
      // It seems to be a real disconnect. We can just destroy the connection.
      // If we wanted to forcefully reconnect, we could call joinVoiceChannel again.
      // For now, let's just let it be destroyed unless the owner explicitly stops it.
    }
  });

  return true;
}

export function stopRadio(guildId) {
  const connection = getVoiceConnection(guildId);
  if (connection) {
    connection.destroy();
  }
  const player = audioPlayers.get(guildId);
  if (player) {
    player.stop();
    audioPlayers.delete(guildId);
  }
}

function playResource(player) {
  try {
    const resource = createAudioResource(audioPath, { inlineVolume: true });
    resource.volume.setVolume(0.70); // 15% leiser (1.0 = 100%, 0.70 = 70%)
    player.play(resource);
  } catch (err) {
    console.error('Failed to play audio resource:', err);
  }
}
