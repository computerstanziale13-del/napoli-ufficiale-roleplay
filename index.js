const token = process.env.DISCORD_TOKEN;
const fs = require('fs');
const { 
    Client, 
    GatewayIntentBits, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    PermissionFlagsBits,
    SlashCommandBuilder,
    REST,
    Routes,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ChannelType
} = require('discord.js');

// --- GESTIONE DATABASE JSON ---
const DB_FILE = './database.json';

function loadDatabase() {
    if (!fs.existsSync(DB_FILE)) {
        const initialData = { arresti: [], multe: [], permajail: [] };
        fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2));
        return initialData;
    }
    try {
        const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        if (!data.permajail) data.permajail = [];
        return data;
    } catch (err) {
        console.error('Errore lettura DB:', err);
        return { arresti: [], multe: [], permajail: [] };
    }
}

function saveDatabase(data) {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
    } catch (err) {
        console.error('Errore salvataggio DB:', err);
    }
}

// Funzione per azzerare COMPLETAMENTE lo storico di un utente (usata per PermaDeath / Reset)
function wipeUserDatabase(username) {
    const db = loadDatabase();
    const targetUser = username.toLowerCase();

    db.arresti = db.arresti.filter(a => a.roblox_user.toLowerCase() !== targetUser);
    db.multe = db.multe.filter(m => m.roblox_user.toLowerCase() !== targetUser);
    db.permajail = db.permajail.filter(p => p.roblox_user.toLowerCase() !== targetUser);

    saveDatabase(db);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// ID Canali Forum per i verbali
const FORUM_ARRESTI_ID = '1533898656309051543';
const FORUM_MULTE_ID = '1533898829903171835';

// URL Thumbnail Pannello
const PANEL_THUMBNAIL = 'https://cdn.discordapp.com/attachments/1529926893825036398/1529929076251295935/Screenshot_2026-07-23-01-27-36-576_com.discord-edit.jpg?ex=6a63b8fc&is=6a62677c&hm=01ff830a49a98363bbae6da6d28fd22899740d77c163533eff10aead05afb4b0&';

const activeSessions = new Map();
const LOGS_FILE = './logs_config.json';

function loadLogChannels() {
    if (!fs.existsSync(LOGS_FILE)) {
        fs.writeFileSync(LOGS_FILE, JSON.stringify({}));
        return new Map();
    }
    try {
        return new Map(Object.entries(JSON.parse(fs.readFileSync(LOGS_FILE, 'utf8'))));
    } catch { return new Map(); }
}

function saveLogChannels(map) {
    try {
        fs.writeFileSync(LOGS_FILE, JSON.stringify(Object.fromEntries(map), null, 2));
    } catch (err) { console.error(err); }
}

const guildLogChannels = loadLogChannels();

/**
 * Recupera User ID, Username esatto e Avatar Headshot da Roblox
 */
async function getRobloxUserData(username) {
    try {
        const userRes = await fetch('https://users.roblox.com/v1/usernames/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ usernames: [username], excludeBannedUsers: false })
        });
        const userData = await userRes.json();
        if (!userData.data || userData.data.length === 0) return null;
        
        const userId = userData.data[0].id;
        const exactUsername = userData.data[0].name;

        const avatarRes = await fetch(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=420x420&format=Png&isCircular=false`);
        const avatarData = await avatarRes.json();
        const avatarUrl = avatarData.data?.[0]?.imageUrl || null;

        return { userId, exactUsername, avatarUrl };
    } catch (error) {
        console.error('Errore durante il recupero dei dati Roblox:', error);
        return null;
    }
}

client.once('clientReady', async () => {
    console.log(`🤖 Bot avviato con successo come ${client.user.tag}!`);

    const commands = [
        new SlashCommandBuilder()
            .setName('setup-log')
            .setDescription('Imposta il canale dove inviare i log del servizio')
            .addChannelOption(o => o.setName('canale').setDescription('Canale di log').setRequired(true))
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

        new SlashCommandBuilder()
            .setName('pannello-servizio')
            .setDescription('Invia un pannello di gestione servizio')
            .addStringOption(o => o.setName('reparto').setDescription('Reparto').setRequired(true).addChoices(
                { name: 'NOCS', value: 'NOCS' },
                { name: 'GIS', value: 'GIS' },
                { name: 'Polizia di Stato', value: 'PdS' },
                { name: 'Carabinieri', value: 'CC' },
                { name: 'Guardia di Finanza', value: 'GdF' }
            ))
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

        new SlashCommandBuilder().setName('arresto').setDescription('Esegui e registra un atto di arresto'),
        new SlashCommandBuilder().setName('multa').setDescription('Esegui e registra una sanzione/multa'),
        new SlashCommandBuilder().setName('permajail').setDescription('Esegui e registra un PermaJail (Ergastolo)'),
        new SlashCommandBuilder().setName('permadeath').setDescription('Notifica una PermaDeath e azzera il database del giocatore'),
        new SlashCommandBuilder()
            .setName('database')
            .setDescription('Consulta la banca dati ed estrai la scheda con gli antecedenti di un utente Roblox')
            .addStringOption(o => o.setName('username').setDescription('Username Roblox del cittadino').setRequired(true))
    ];

    const rest = new REST({ version: '10' }).setToken(token);
    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('✅ Comandi globali registrati correttamente!');
    } catch (err) {
        console.error('❌ Errore durante la registrazione dei comandi:', err);
    }
});

// Gestione Slash Commands & Modals
client.on('interactionCreate', async interaction => {
    
    if (interaction.isChatInputCommand()) {
        const { commandName, guildId } = interaction;

        if (commandName === 'setup-log') {
            const channel = interaction.options.getChannel('canale');
            guildLogChannels.set(guildId, channel.id);
            saveLogChannels(guildLogChannels);
            return interaction.reply({ content: `✅ Canale log salvato correttamente: ${channel}`, ephemeral: true });
        }

        if (commandName === 'pannello-servizio') {
            const reparto = interaction.options.getString('reparto');
            const embed = new EmbedBuilder()
                .setTitle(`Pannello di Controllo — ${reparto}`)
                .setDescription(`Pannello ufficiale di tracciamento turni per **${reparto}**.\nUsa i pulsanti sottostanti per gestire il tuo servizio.`)
                .setColor('#0055A5')
                .setThumbnail(PANEL_THUMBNAIL);

            const buttons = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`btn_start_${reparto}`).setLabel('Inizia Servizio').setEmoji('🟢').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`btn_pause_${reparto}`).setLabel('Pausa Servizio').setEmoji('⏸️').setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId(`btn_resume_${reparto}`).setLabel('Riprendi Servizio').setEmoji('▶️').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId(`btn_stop_${reparto}`).setLabel('Finisci Servizio').setEmoji('🔴').setStyle(ButtonStyle.Danger)
            );

            await interaction.channel.send({ embeds: [embed], components: [buttons] });
            return interaction.reply({ content: 'Pannello inviato!', ephemeral: true });
        }

        if (commandName === 'arresto') {
            const modal = new ModalBuilder().setCustomId('modal_arresto').setTitle('Modulo Registrazione Arresto');
            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('roblox_user').setLabel('Username Roblox del Sospetto').setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('arrest_time').setLabel('Durata Fermo / Carcere (in Minuti)').setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('arrest_reason').setLabel('Reati Commessi / Motivazione').setStyle(TextInputStyle.Paragraph).setRequired(true))
            );
            return await interaction.showModal(modal);
        }

        if (commandName === 'multa') {
            const modal = new ModalBuilder().setCustomId('modal_multa').setTitle('Modulo Emissione Sanzione / Multa');
            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('roblox_user').setLabel('Username Roblox del Trasgressore').setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('fine_amount').setLabel('Importo Multa (€)').setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('fine_reason').setLabel('Motivazione Sanzione / Infrazione').setStyle(TextInputStyle.Paragraph).setRequired(true))
            );
            return await interaction.showModal(modal);
        }

        if (commandName === 'permajail') {
            const modal = new ModalBuilder().setCustomId('modal_permajail').setTitle('Modulo Registrazione PermaJail');
            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('roblox_user').setLabel('Username Roblox del Detenuto').setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('jail_reason').setLabel('Motivo / Reati Commessi').setStyle(TextInputStyle.Paragraph).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('jail_notes').setLabel('Note Aggiuntive').setStyle(TextInputStyle.Paragraph).setRequired(false))
            );
            return await interaction.showModal(modal);
        }

        if (commandName === 'permadeath') {
            const modal = new ModalBuilder().setCustomId('modal_permadeath').setTitle('Modulo Registrazione PermaDeath');
            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('roblox_user').setLabel('Username Roblox del Defunto').setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('death_reason').setLabel('Motivo / Accaduto').setStyle(TextInputStyle.Paragraph).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('death_notes').setLabel('Dettagli / Note').setStyle(TextInputStyle.Paragraph).setRequired(false))
            );
            return await interaction.showModal(modal);
        }

        // --- COMANDO DATABASE ---
        if (commandName === 'database') {
            await interaction.deferReply();
            const usernameInput = interaction.options.getString('username');
            const robloxData = await getRobloxUserData(usernameInput);

            if (!robloxData) return interaction.editReply({ content: `❌ Utente Roblox **${usernameInput}** non trovato!` });

            const db = loadDatabase();
            const targetUser = robloxData.exactUsername.toLowerCase();

            const arresti = db.arresti.filter(a => a.roblox_user.toLowerCase() === targetUser);
            const multe = db.multe.filter(m => m.roblox_user.toLowerCase() === targetUser);
            const isPermaJail = db.permajail.some(p => p.roblox_user.toLowerCase() === targetUser);

            const totalMinuti = arresti.reduce((acc, a) => acc + Number(a.durata), 0);
            const totalEuro = multe.reduce((acc, m) => acc + Number(m.importo), 0);

            const arrestiLista = arresti.map(a => `• **Minuti:** \`${a.durata} min\` | **Motivo:** ${a.motivo}`);
            const multeLista = multe.map(m => `• **Importo:** \`${m.importo} €\` | **Motivo:** ${m.motivo}`);

            let statoGiudiziario = '🟢 Incensurato / Regolare';
            let color = '#2ECC71';

            if (isPermaJail) {
                statoGiudiziario = '🔒 **PERMAJAIL (Ergastolo)**';
                color = '#4A0E17';
            } else if (arresti.length > 0) {
                statoGiudiziario = '🚨 **Pregiudicato (Arresti)**';
                color = '#8B0000';
            } else if (multe.length > 0) {
                statoGiudiziario = '💶 **Sanzionato (Multe)**';
                color = '#E67E22';
            }

            const dbEmbed = new EmbedBuilder()
                .setTitle(`📁 Scheda Giudiziaria — ${robloxData.exactUsername}`)
                .setURL(`https://www.roblox.com/users/${robloxData.userId}/profile`)
                .setColor(color)
                .setThumbnail(robloxData.avatarUrl)
                .addFields(
                    { name: '👤 Utente Roblox', value: `**[${robloxData.exactUsername}](https://www.roblox.com/users/${robloxData.userId}/profile)**\n(ID: \`${robloxData.userId}\`)`, inline: true },
                    { name: '📋 Stato Scheda', value: statoGiudiziario, inline: true },
                    { name: '📊 Totale Sanzioni', value: `🚨 **${arresti.length}** Arresti (${totalMinuti} m)\n💶 **${totalEuro} €** Multe`, inline: true },
                    { 
                        name: '📜 Storico Arresti', 
                        value: arrestiLista.length > 0 ? arrestiLista.slice(0, 5).join('\n') : '🟢 Nessun arresto a carico.' 
                    },
                    { 
                        name: '📝 Storico Multe', 
                        value: multeLista.length > 0 ? multeLista.slice(0, 5).join('\n') : '🟢 Nessuna sanzione a carico.' 
                    }
                )
                .setFooter({ text: 'Banca Dati Centrale — Forze dell\'Ordine' })
                .setTimestamp();

            return interaction.editReply({ embeds: [dbEmbed] });
        }
    }

    // --- GESTIONE INVIO MODAL ---
    if (interaction.isModalSubmit()) {
        const { customId, guild, user } = interaction;

        if (customId === 'modal_arresto') {
            await interaction.deferReply({ ephemeral: true });
            const robloxUser = interaction.fields.getTextInputValue('roblox_user');
            const duration = parseInt(interaction.fields.getTextInputValue('arrest_time')) || 0;
            const reason = interaction.fields.getTextInputValue('arrest_reason');

            const robloxData = await getRobloxUserData(robloxUser);
            if (!robloxData) return interaction.editReply({ content: '❌ Utente Roblox non trovato.' });

            const db = loadDatabase();
            db.arresti.push({
                roblox_user: robloxData.exactUsername,
                durata: duration,
                motivo: reason,
                agente: user.tag,
                timestamp: new Date().toISOString()
            });
            saveDatabase(db);

            const forumChannel = guild.channels.cache.get(FORUM_ARRESTI_ID);
            if (forumChannel && forumChannel.type === ChannelType.GuildForum) {
                const arrestEmbed = new EmbedBuilder()
                    .setTitle('🚨 Verbale di Arresto Eseguito')
                    .setColor('#8B0000')
                    .setThumbnail(robloxData.avatarUrl)
                    .addFields(
                        { name: '👤 Soggetto Arrestato', value: `**[${robloxData.exactUsername}](https://www.roblox.com/users/${robloxData.userId}/profile)**`, inline: true },
                        { name: '⏱️ Durata Carcere', value: `\`${duration} minuti\``, inline: true },
                        { name: '👮 Operatore', value: `${user}`, inline: true },
                        { name: '📜 Reati Imputati', value: reason, inline: false }
                    )
                    .setFooter({ text: 'Sistema Giudiziario / Polizia' })
                    .setTimestamp();

                await forumChannel.threads.create({
                    name: `🚨 Arresto - ${robloxData.exactUsername}`,
                    message: { embeds: [arrestEmbed] }
                });
            }

            return interaction.editReply({ content: `✅ Arresto per **${robloxData.exactUsername}** salvato correttamente nel Database e inviato nel Forum!` });
        }

        if (customId === 'modal_multa') {
            await interaction.deferReply({ ephemeral: true });
            const robloxUser = interaction.fields.getTextInputValue('roblox_user');
            const amount = parseInt(interaction.fields.getTextInputValue('fine_amount')) || 0;
            const reason = interaction.fields.getTextInputValue('fine_reason');

            const robloxData = await getRobloxUserData(robloxUser);
            if (!robloxData) return interaction.editReply({ content: '❌ Utente Roblox non trovato.' });

            const db = loadDatabase();
            db.multe.push({
                roblox_user: robloxData.exactUsername,
                importo: amount,
                motivo: reason,
                agente: user.tag,
                timestamp: new Date().toISOString()
            });
            saveDatabase(db);

            const forumChannel = guild.channels.cache.get(FORUM_MULTE_ID);
            if (forumChannel && forumChannel.type === ChannelType.GuildForum) {
                const fineEmbed = new EmbedBuilder()
                    .setTitle('💶 Verbale di Sanzione Amministrativa')
                    .setColor('#E67E22')
                    .setThumbnail(robloxData.avatarUrl)
                    .addFields(
                        { name: '👤 Trasgressore', value: `**[${robloxData.exactUsername}](https://www.roblox.com/users/${robloxData.userId}/profile)**`, inline: true },
                        { name: '💰 Importo Multa', value: `\`${amount} €\``, inline: true },
                        { name: '👮 Agente Accertatore', value: `${user}`, inline: true },
                        { name: '📝 Motivazione', value: reason, inline: false }
                    )
                    .setFooter({ text: 'Sistema Amministrativo / Polizia' })
                    .setTimestamp();

                await forumChannel.threads.create({
                    name: `💶 Multa - ${robloxData.exactUsername}`,
                    message: { embeds: [fineEmbed] }
                });
            }

            return interaction.editReply({ content: `✅ Multa per **${robloxData.exactUsername}** salvata correttamente nel Database e inviata nel Forum!` });
        }

        // --- MODAL PERMAJAIL ---
        if (customId === 'modal_permajail') {
            await interaction.deferReply();
            const robloxUser = interaction.fields.getTextInputValue('roblox_user');
            const reason = interaction.fields.getTextInputValue('jail_reason');
            const customNotes = interaction.fields.getTextInputValue('jail_notes') || 'Nessuna nota aggiuntiva fornita.';

            const robloxData = await getRobloxUserData(robloxUser);
            if (!robloxData) return interaction.editReply({ content: '❌ Utente Roblox non trovato.' });

            // Pulisce arresti e multe passate prima di registrare il PermaJail
            wipeUserDatabase(robloxData.exactUsername);

            // Registra solo PermaJail nel database
            const db = loadDatabase();
            db.permajail.push({
                roblox_user: robloxData.exactUsername,
                motivo: reason,
                agente: user.tag,
                timestamp: new Date().toISOString()
            });
            saveDatabase(db);

            const permaJailEmbed = new EmbedBuilder()
                .setTitle('🔒 ATTO DI ERGASTOLO / PERMAJAIL')
                .setColor('#4A0E17')
                .setThumbnail(robloxData.avatarUrl)
                .addFields(
                    { name: '👤 Detenuto', value: `**[${robloxData.exactUsername}](https://www.roblox.com/users/${robloxData.userId}/profile)**`, inline: true },
                    { name: '👮 Agente / Giudice', value: `${user}`, inline: true },
                    { name: '⏱️ Pena Comminata', value: '`ERGASTOLO (A Vita)`', inline: true },
                    { name: '📜 Motivo / Reati Commessi', value: reason, inline: false },
                    { name: '📝 Note Operative', value: customNotes, inline: false },
                    { 
                        name: '⚠️ NOTA IMPORTANTE PER IL GIOCATORE', 
                        value: '```txt\nIl personaggio è stato condannato al PermaJail. Si consiglia vivamente di effettuare il Wipe/Reset del personaggio Roblox per poter rientrare nel Roleplay.\n```', 
                        inline: false 
                    }
                )
                .setFooter({ text: 'Database Giudiziario — Registrazione Ergastolo' })
                .setTimestamp();

            await interaction.channel.send({ embeds: [permaJailEmbed] });
            return interaction.editReply({ content: `✅ **PermaJail** registrato per **${robloxData.exactUsername}**!`, ephemeral: true });
        }

        // --- MODAL PERMADEATH ---
        if (customId === 'modal_permadeath') {
            await interaction.deferReply();
            const robloxUser = interaction.fields.getTextInputValue('roblox_user');
            const reason = interaction.fields.getTextInputValue('death_reason');
            const customNotes = interaction.fields.getTextInputValue('death_notes') || 'Nessuna nota aggiuntiva fornita.';

            const robloxData = await getRobloxUserData(robloxUser);
            if (!robloxData) return interaction.editReply({ content: '❌ Utente Roblox non trovato.' });

            // AZZERA COMPLETAMENTE IL DATABASE DELL'UTENTE (NON SALVA PERMADEATH NEL DB)
            wipeUserDatabase(robloxData.exactUsername);

            const permaDeathEmbed = new EmbedBuilder()
                .setTitle('💀 VERBALE DI MORTE PERMANENTE (PERMADEATH)')
                .setColor('#000000')
                .setThumbnail(robloxData.avatarUrl)
                .addFields(
                    { name: '👤 Soggetto Deceduto', value: `**[${robloxData.exactUsername}](https://www.roblox.com/users/${robloxData.userId}/profile)**`, inline: true },
                    { name: '👮 Agente / Medico Accertatore', value: `${user}`, inline: true },
                    { name: '⚰️ Stato Personaggio', value: '`DECEDUTO (PermaDeath)`', inline: true },
                    { name: '📜 Motivo / Accaduto', value: reason, inline: false },
                    { name: '📝 Note & Dettagli', value: customNotes, inline: false },
                    { 
                        name: '⚠️ NOTA IMPORTANTE PER IL GIOCATORE', 
                        value: '```txt\nIl personaggio è deceduto in via definitiva. Si consiglia di ricreare il personaggio da zero per proseguire l\'esperienza di gioco.\n```', 
                        inline: false 
                    }
                )
                .setFooter({ text: 'Registro Anagrafico — Scheda Giudiziaria Resettata' })
                .setTimestamp();

            await interaction.channel.send({ embeds: [permaDeathEmbed] });
            return interaction.editReply({ content: `💀 **PermaDeath** inviata! Il database di **${robloxData.exactUsername}** è stato azzerato completamente e la sua scheda torna pulita per un nuovo PG.`, ephemeral: true });
        }
    }
});

function formatDuration(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${hours}h ${minutes}m ${seconds}s`;
}

// Gestione Pulsanti del Servizio
client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;

    const { customId, user, guild, guildId } = interaction;
    const logChannelId = guildLogChannels.get(guildId);
    const logChannel = logChannelId ? guild.channels.cache.get(logChannelId) : null;

    const parts = customId.split('_');
    const action = parts[1]; 
    const reparto = parts[2];

    let session = activeSessions.get(user.id);

    if (action === 'start') {
        if (session) return interaction.reply({ content: `❌ Sei già in servizio per **${session.reparto}**!`, ephemeral: true });

        activeSessions.set(user.id, { startTime: Date.now(), totalPauseMs: 0, pauseStartTime: null, state: 'ACTIVE', reparto });
        await interaction.reply({ content: `🟢 **Servizio ${reparto} avviato!**`, ephemeral: true });

        if (logChannel) {
            logChannel.send({ embeds: [new EmbedBuilder().setTitle(`🟢 Inizio Servizio — ${reparto}`).setColor('#2ECC71').setDescription(`L'operatore ${user} ha iniziato il turno.`).setTimestamp()] });
        }
    }

    if (action === 'pause') {
        if (!session) return interaction.reply({ content: '❌ Non sei in servizio!', ephemeral: true });
        if (session.state === 'PAUSED') return interaction.reply({ content: '⚠️ Servizio già in pausa!', ephemeral: true });

        session.state = 'PAUSED';
        session.pauseStartTime = Date.now();
        await interaction.reply({ content: `⏸️ **Servizio ${session.reparto} in pausa.**`, ephemeral: true });

        if (logChannel) {
            logChannel.send({ embeds: [new EmbedBuilder().setTitle(`⏸️ Pausa Servizio — ${session.reparto}`).setColor('#F1C40F').setDescription(`L'operatore ${user} è in pausa.`).setTimestamp()] });
        }
    }

    if (action === 'resume') {
        if (!session) return interaction.reply({ content: '❌ Non sei in servizio!', ephemeral: true });
        if (session.state === 'ACTIVE') return interaction.reply({ content: '⚠️ Servizio già attivo!', ephemeral: true });

        session.totalPauseMs += Date.now() - session.pauseStartTime;
        session.pauseStartTime = null;
        session.state = 'ACTIVE';
        await interaction.reply({ content: `▶️ **Servizio ${session.reparto} ripreso.**`, ephemeral: true });

        if (logChannel) {
            logChannel.send({ embeds: [new EmbedBuilder().setTitle(`▶️ Ripresa Servizio — ${session.reparto}`).setColor('#3498DB').setDescription(`L'operatore ${user} ha ripreso il turno.`).setTimestamp()] });
        }
    }

    if (action === 'stop') {
        if (!session) return interaction.reply({ content: '❌ Non sei in servizio!', ephemeral: true });

        const now = Date.now();
        let totalPause = session.totalPauseMs + (session.state === 'PAUSED' ? (now - session.pauseStartTime) : 0);
        const formattedTime = formatDuration(now - session.startTime - totalPause);
        const currentReparto = session.reparto;

        activeSessions.delete(user.id);
        await interaction.reply({ content: `🔴 **Servizio ${currentReparto} terminato!** Durata effettiva: **${formattedTime}**.`, ephemeral: true });

        if (logChannel) {
            logChannel.send({ embeds: [new EmbedBuilder().setTitle(`🔴 Fine Servizio — ${currentReparto}`).setColor('#E74C3C').setDescription(`L'operatore ${user} ha terminato il turno.`).addFields({ name: '⏱️ Tempo Effettivo', value: `\`${formattedTime}\`` }).setTimestamp()] });
        }
    }
});

client.login(token);
