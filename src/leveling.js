import { db } from './database/database.js';
import { EmbedBuilder } from 'discord.js';

const COOLDOWN_MS = 60 * 1000; // 1 minute cooldown for messages
const VOICE_INTERVAL_MS = 60 * 1000; // 1 minute interval for voice check
const DAILY_VOICE_MAX = 60; // Max 60 voice points per day
const INACTIVITY_PENALTY = 10; // XP to deduct
const INACTIVITY_DAYS = 3; // Days of inactivity before penalty starts

export const LEVEL_ROLES = {
  1: '1526257241785765932',
  2: '1526257496627613797',
  3: '1526257530941214720',
  4: '1526257564181069824'
};

export const LEVEL_THRESHOLDS = {
  1: 1000,
  2: 3000,
  3: 7000,
  4: 15000
};

export function setupLeveling(client) {
  // Voice XP Interval
  setInterval(async () => {
    try {
      const allUsers = await db.getAllUsers();
      
      // Handle Voice XP
      client.guilds.cache.forEach(guild => {
        guild.channels.cache.filter(c => c.isVoiceBased()).forEach(async channel => {
          // Count non-bot members
          const members = channel.members.filter(m => !m.user.bot);
          if (members.size >= 2) {
            for (const [memberId, member] of members) {
              let user = await db.getUser(memberId);
              
              // Daily reset check
              const now = Date.now();
              const today = Math.floor(now / (24 * 60 * 60 * 1000));
              if (user.dailyVoiceReset !== today) {
                user.dailyVoicePoints = 0;
                user.dailyVoiceReset = today;
              }

              if (user.dailyVoicePoints < DAILY_VOICE_MAX) {
                user.xp += 1; // 1 XP per minute
                user.dailyVoicePoints += 1;
                user.lastMessageTimestamp = now; // update activity
                await checkLevelUp(client, guild, member, user);
                await db.updateUser(memberId, user);
              }
            }
          }
        });
      });

      // Handle Inactivity Penalty
      const now = Date.now();
      for (const [userId, user] of Object.entries(allUsers)) {
         if (user.lastMessageTimestamp > 0) {
           const daysInactive = (now - user.lastMessageTimestamp) / (1000 * 60 * 60 * 24);
           
           if (daysInactive >= INACTIVITY_DAYS) {
              if (!user.lastPenaltyTimestamp) user.lastPenaltyTimestamp = 0;
              const daysSinceLastPenalty = (now - user.lastPenaltyTimestamp) / (1000 * 60 * 60 * 24);
              if (daysSinceLastPenalty >= 1) {
                 user.xp = Math.max(0, user.xp - INACTIVITY_PENALTY);
                 user.lastPenaltyTimestamp = now;
                 await db.updateUser(userId, user);
              }
           }
         }
      }

    } catch (err) {
      console.error('Fehler im Leveling Interval:', err);
    }
  }, VOICE_INTERVAL_MS);
}

export async function handleMessageXP(message) {
  if (message.author.bot || !message.guild) return;

  const userId = message.author.id;
  let user = await db.getUser(userId);

  const now = Date.now();
  if (now - user.lastMessageTimestamp > COOLDOWN_MS) {
    const xpToAdd = Math.floor(Math.random() * 6) + 5; // 5 to 10 XP
    user.xp += xpToAdd;
    user.lastMessageTimestamp = now;
    
    await checkLevelUp(message.client, message.guild, message.member, user);
    await db.updateUser(userId, user);
  }
}

async function checkLevelUp(client, guild, member, user) {
  let newLevel = user.level || 0; // fallback

  if (user.xp >= LEVEL_THRESHOLDS[4]) newLevel = 4;
  else if (user.xp >= LEVEL_THRESHOLDS[3]) newLevel = 3;
  else if (user.xp >= LEVEL_THRESHOLDS[2]) newLevel = 2;
  else if (user.xp >= LEVEL_THRESHOLDS[1]) newLevel = 1;
  else newLevel = 0;

  if (newLevel > (user.level || 0)) {
    // Leveled up!
    user.level = newLevel;
    
    // Manage roles
    const roleIdToAdd = LEVEL_ROLES[newLevel];
    if (roleIdToAdd) {
      const role = guild.roles.cache.get(roleIdToAdd);
      if (role && member) {
        await member.roles.add(role).catch(() => {});
      }
    }

    // Remove previous roles
    for (let i = 1; i < newLevel; i++) {
      const oldRoleId = LEVEL_ROLES[i];
      if (oldRoleId) {
        if (member && member.roles.cache.has(oldRoleId)) {
          const oldRole = guild.roles.cache.get(oldRoleId);
          if (oldRole) await member.roles.remove(oldRole).catch(() => {});
        }
      }
    }

    try {
       let levelTitle = '🚀 Du bist ein Level aufgestiegen!';
       let levelDesc = '';

       switch(newLevel) {
         case 1:
           levelDesc = `Mega cool, dass du ein aktiver Teil unserer Community bist! 🧡\n\nDurch deine Aktivität hast du dir **Level 1** auf **${guild.name}** verdient!\n\nJe aktiver du im Voice- und Text-Chat bist, desto höher steigst du im Rank. Wir freuen uns, dass du dabei bist!`;
           break;
         case 2:
           levelDesc = `Wahnsinn, du bist gut dabei! 🔥\n\nDu hast soeben **Level 2** auf **${guild.name}** geknackt. Danke für deine Aktivität in der Community!\n\nBleib weiter am Ball, die nächsten Ränge warten schon auf dich.`;
           break;
         case 3:
           levelDesc = `Respekt! Du gehörst langsam zum harten Kern! 👑\n\nDein massiver Einsatz hat sich gelohnt: Du bist jetzt **Level 3** auf **${guild.name}**!\n\nWir schätzen deinen Beitrag zum Server enorm. Weiter so!`;
           break;
         case 4:
           levelTitle = '🤯 UNGLAUBLICH! HÖCHSTES LEVEL ERREICHT!';
           levelDesc = `Du bist einfach unfassbar! 🏆\n\nDu hast das absolute Maximum erreicht und bist nun **Level 4** auf **${guild.name}**!\n\nDanke für deine unglaubliche Treue und Aktivität. Du bist eine wahre Legende in unserer Community! 🧡`;
           break;
         default:
           levelDesc = `Mega cool, dass du ein aktiver Teil unserer Community bist! 🧡\n\nDurch deine Aktivität hast du **Level ${newLevel}** auf **${guild.name}** erreicht!\n\nJe aktiver du im Voice- und Text-Chat bist, desto höher steigst du im Rank. Mach weiter so!`;
           break;
       }

       const embed = new EmbedBuilder()
         .setTitle(levelTitle)
         .setDescription(levelDesc)
         .setColor('#f97316')
         .setThumbnail('https://images-ext-1.discordapp.net/external/R5SJEWiQb8Qhdj8qYdHWNdhKKufBHGDAFm99OTi7WRc/https/imgur.com/p9YGWp5.png?format=webp&quality=lossless');
       await member.send({ embeds: [embed] }).catch(() => {});
    } catch(e) {}
  } else if (newLevel < (user.level || 0)) {
    // Leveled down!
    user.level = newLevel;
    
    // Manage roles: Add new, remove old
    for (let i = 1; i <= 4; i++) {
      const roleId = LEVEL_ROLES[i];
      if (!roleId) continue;
      
      if (i === newLevel) {
        if (!member.roles.cache.has(roleId)) {
          const role = guild.roles.cache.get(roleId);
          if (role) await member.roles.add(role).catch(() => {});
        }
      } else {
        if (member.roles.cache.has(roleId)) {
          const role = guild.roles.cache.get(roleId);
          if (role) await member.roles.remove(role).catch(() => {});
        }
      }
    }
  }
}

export async function updateUserXPFromDashboard(client, userId, newXp) {
  let user = await db.getUser(userId);
  user.xp = parseInt(newXp, 10) || 0;
  if (user.xp < 0) user.xp = 0;
  
  const GUILD_ID = '1294669609349283925';
  let guild = null;
  let member = null;
  
  if (client.isReady()) {
     guild = client.guilds.cache.get(GUILD_ID);
     if (guild) {
        try {
           member = await guild.members.fetch(userId);
        } catch(e) {}
     }
  }

  let newLevel = 0;
  if (user.xp >= LEVEL_THRESHOLDS[4]) newLevel = 4;
  else if (user.xp >= LEVEL_THRESHOLDS[3]) newLevel = 3;
  else if (user.xp >= LEVEL_THRESHOLDS[2]) newLevel = 2;
  else if (user.xp >= LEVEL_THRESHOLDS[1]) newLevel = 1;

  const oldLevel = user.level || 0;
  user.level = newLevel;
  
  await db.updateUser(userId, user);

  if (guild && member && newLevel !== oldLevel) {
    for (let i = 1; i <= 4; i++) {
       const roleId = LEVEL_ROLES[i];
       if (!roleId) continue;
       
       if (i === newLevel) {
          if (!member.roles.cache.has(roleId)) {
             const role = guild.roles.cache.get(roleId);
             if (role) await member.roles.add(role).catch(() => {});
          }
       } else {
          if (member.roles.cache.has(roleId)) {
             const role = guild.roles.cache.get(roleId);
             if (role) await member.roles.remove(role).catch(() => {});
          }
       }
    }
  }
}

export function getRequiredXP(level) {
    if (level === 0 || !level) return LEVEL_THRESHOLDS[1];
    return LEVEL_THRESHOLDS[level + 1] || 'MAX';
}
