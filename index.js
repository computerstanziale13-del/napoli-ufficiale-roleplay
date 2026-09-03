const token = process.env.DISCORD_TOKEN;
const fs = require('fs');
const express = require('express');
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

// --- SERVER EXPRESS PER UPTIMEROBOT & RENDER ---
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('🤖 Bot Discord Roleplay è online e attivo!');
});

app.listen(PORT, () => {
    console.log(`🌐 Server Web avviato sulla porta ${PORT}`);
});

// --- CONSTANTS & LOGO ---
const REQUESTS_CHANNEL_ID = '1542488611470057516';
const FORUM_ARRESTI_ID = '1533898656309051543';
const FORUM_MULTE_ID = '1533898829903171835';

const GLOBAL_LOGO = 'https://cdn.discordapp.com/attachments/1532820317112893662/1545010053935800360/ChatGPT_Image_1_set_2026_21_28_29.png?ex=6a9a963d&is=6a9944bd&hm=0de62600ef2e833f064758a4a2b79295956fcdc1589acefe47fdb7eb08d15499&';

// --- GESTIONE DATABASE JSON ---
const DB_FILE = './database.json';

function loadDatabase() {
    if (!fs.existsSync(DB_FILE)) {
        const initialData = { arresti: [], multe: [], permajail: [], cittadini: [], licenze: [] };
        fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2));
        return initialData;
    }
    try {
        const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        if (!data.permajail) data.permajail = [];
        if (!data.arresti) data.arresti = [];
        if (!data.multe) data.multe = [];
        if (!data.cittadini) data.cittadini = [];
        if (!data.licenze) data.licenze = [];
        return data;
    } catch (err) {
        console.error('Errore lettura DB:', err);
        return { arresti: [], multe: [], permajail: [], cittadini: [], licenze: [] };
    }
}

function saveDatabase(data) {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
    } catch (err) {
        console.error('Errore salvataggio DB:', err);
    }
}

function wipeUserDatabase(username) {
    const db = loadDatabase();
    const targetUser = username.toLowerCase();

    db.arresti = db.arresti.filter(a => a.roblox_user.toLowerCase() !== targetUser);
    db.multe = db.multe.filter(m => m.roblox_user.toLowerCase() !== targetUser);
    db.permajail = db.permajail.filter(p => p.roblox_user.toLowerCase() !== targetUser);
    db.cittadini = db.cittadini.filter(c => c.roblox_user.toLowerCase() !== targetUser);
    db.licenze = db.licenze.filter(l => l.roblox_user.toLowerCase() !== targetUser);

    saveDatabase(db);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

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

        new SlashCommandBuilder()
            .setName('pannello-documenti')
            .setDescription('Invia il pannello per richiedere Cittadinanza, Patente e Porto d\'Armi')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

        new SlashCommandBuilder().setName('arresto').setDescription('Esegui e registra un atto di arresto'),
        new SlashCommandBuilder().setName('multa').setDescription('Esegui e registra una sanzione/multa'),
        new SlashCommandBuilder().setName('permajail').setDescription('Esegui e registra un PermaJail (Ergastolo)'),
        new SlashCommandBuilder().setName('permadeath').setDescription('Notifica una PermaDeath e azzera il database del giocatore'),
        new SlashCommandBuilder()
            .setName('database')
            .setDescription('Consulta la banca dati ed estrai la scheda di un utente per Username Roblox o Nome RP')
            .addStringOption(o => o.setName('ricerca').setDescription('Username Roblox OPPURE Nome e Cognome RP').setRequired(true))
    ];

    const rest = new REST({ version: '10' }).setToken(token);
    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        console.log('✅ Comandi globali registrati correttamente!');
    } catch (err) {
        console.error('❌ Errore durante la registrazione dei comandi:', err);
    }
});

// Gestione Slash Commands
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

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
            .setThumbnail(GLOBAL_LOGO);

        const buttons = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`btn_start_${reparto}`).setLabel('Inizia Servizio').setEmoji('🟢').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`btn_pause_${reparto}`).setLabel('Pausa Servizio').setEmoji('⏸️').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`btn_resume_${reparto}`).setLabel('Riprendi Servizio').setEmoji('▶️').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`btn_stop_${reparto}`).setLabel('Finisci Servizio').setEmoji('🔴').setStyle(ButtonStyle.Danger)
        );

        await interaction.channel.send({ embeds: [embed], components: [buttons] });
        return interaction.reply({ content: 'Pannello inviato!', ephemeral: true });
    }

    if (commandName === 'pannello-documenti') {
        const embed = new EmbedBuilder()
            .setTitle('🏛️ UFFICIO ANAGRAFE E LICENZE RP')
            .setDescription('Benvenuto allo sportello virtuale del Comune.\nSeleziona il bottone corrispondente per richiedere i tuoi documenti RP.\n\n📌 **Documenti Disponibili:**\n• **Cittadinanza RP:** Registrazione del Personaggio nel Comune\n• **Patente di Guida:** Licenza di guida autoveicoli\n• **Porto d\'Armi:** Licenza per porto e detenzione armi')
            .setColor('#34495E')
            .setThumbnail(GLOBAL_LOGO);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('doc_req_cittadinanza').setLabel('Richiedi Cittadinanza').setStyle(ButtonStyle.Primary).setEmoji('🆔'),
            new ButtonBuilder().setCustomId('doc_req_patente').setLabel('Richiedi Patente').setStyle(ButtonStyle.Success).setEmoji('🚗'),
            new ButtonBuilder().setCustomId('doc_req_portodarmi').setLabel('Richiedi Porto d\'Armi').setStyle(ButtonStyle.Danger).setEmoji('🔫')
        );

        await interaction.channel.send({ embeds: [embed], components: [row] });
        return interaction.reply({ content: 'Pannello documenti inviato!', ephemeral: true });
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

    // --- COMANDO DATABASE CONSULTABILE SOLO DA DB ---
    if (commandName === 'database') {
        await interaction.deferReply();
        const queryInput = interaction.options.getString('ricerca').trim();
        const db = loadDatabase();

        // 1. Cerca nei Cittadini per Nome RP o Username Roblox
        let cittadino = db.cittadini.find(c => 
            c.nome_rp.toLowerCase() === queryInput.toLowerCase() || 
            c.roblox_user.toLowerCase() === queryInput.toLowerCase()
        );

        let robloxUsername = cittadino ? cittadino.roblox_user : queryInput;
        let robloxData = await getRobloxUserData(robloxUsername);

        if (!robloxData && !cittadino) {
            return interaction.editReply({ content: `❌ Nessun dato o account Roblox trovato per **${queryInput}**.` });
        }

        const targetRoblox = robloxData ? robloxData.exactUsername.toLowerCase() : robloxUsername.toLowerCase();

        // Estrazione dati dal DB
        const arresti = db.arresti.filter(a => a.roblox_user.toLowerCase() === targetRoblox);
        const multe = db.multe.filter(m => m.roblox_user.toLowerCase() === targetRoblox);
        const isPermaJail = db.permajail.some(p => p.roblox_user.toLowerCase() === targetRoblox);
        const licenzeUtente = db.licenze.filter(l => l.roblox_user.toLowerCase() === targetRoblox);

        const totalMinuti = arresti.reduce((acc, a) => acc + Number(a.durata), 0);
        const totalEuro = multe.reduce((acc, m) => acc + Number(m.importo), 0);

        const arrestiLista = arresti.map(a => `• **Minuti:** \`${a.durata} m\` | **Motivo:** ${a.motivo}`);
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

        const patentes = licenzeUtente.filter(l => l.tipo === 'Patente').map(l => `• Valida (Data: ${l.data})`);
        const portiArmi = licenzeUtente.filter(l => l.tipo === 'Porto d\'Armi').map(l => `• Valido (Data: ${l.data})`);

        const dbEmbed = new EmbedBuilder()
            .setTitle(`📁 SCHEDA ANAGRAFICA & GIUDIZIARIA`)
            .setColor(color)
            .setThumbnail(GLOBAL_LOGO)
            .addFields(
                { name: '👤 Nome & Cognome RP', value: cittadino ? `**${cittadino.nome_rp}**` : '*Non Registrato in Anagrafe*', inline: true },
                { name: '📅 Data di Nascita RP', value: cittadino ? `\`${cittadino.data_nascita}\`` : '*N/D*', inline: true },
                { name: '🎮 Account Roblox', value: robloxData ? `**[${robloxData.exactUsername}](https://www.roblox.com/users/${robloxData.userId}/profile)**\n(ID: \`${robloxData.userId}\`)` : `\`${robloxUsername}\``, inline: true },
                { name: '📋 Stato Giudiziario', value: statoGiudiziario, inline: true },
                { name: '🚗 Patente di Guida', value: patentes.length > 0 ? patentes.join('\n') : '❌ Assente', inline: true },
                { name: '🔫 Porto d\'Armi', value: portiArmi.length > 0 ? portiArmi.join('\n') : '❌ Assente', inline: true },
                { name: '📊 Riepilogo Sanzioni', value: `🚨 **${arresti.length}** Arresti (${totalMinuti} m)\n💶 **${totalEuro} €** Multe`, inline: false },
                { name: '📜 Storico Arresti', value: arrestiLista.length > 0 ? arrestiLista.slice(0, 5).join('\n') : '🟢 Nessun arresto a carico.' },
                { name: '📝 Storico Multe', value: multeLista.length > 0 ? multeLista.slice(0, 5).join('\n') : '🟢 Nessuna sanzione a carico.' }
            )
            .setFooter({ text: 'Banca Dati Centrale — Comune & Forze dell\'Ordine' })
            .setTimestamp();

        return interaction.editReply({ embeds: [dbEmbed] });
    }
});

// Gestione Interazioni Bottoni Moduli Documenti
client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;

    const { customId } = interaction;

    if (customId === 'doc_req_cittadinanza') {
        const modal = new ModalBuilder().setCustomId('modal_doc_cittadinanza').setTitle('Richiesta Cittadinanza RP');
        modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('nome_rp').setLabel('Nome e Cognome RP').setStyle(TextInputStyle.Short).setPlaceholder('es. Marco Rossi').setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('data_nascita').setLabel('Data di Nascita RP').setStyle(TextInputStyle.Short).setPlaceholder('GG/MM/AAAA').setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('roblox_user').setLabel('Username Roblox Esatto').setStyle(TextInputStyle.Short).setRequired(true))
        );
        return await interaction.showModal(modal);
    }

    if (customId === 'doc_req_patente') {
        const modal = new ModalBuilder().setCustomId('modal_doc_patente').setTitle('Richiesta Patente di Guida');
        modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('nome_rp').setLabel('Nome e Cognome RP').setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('roblox_user').setLabel('Username Roblox Esatto').setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('motivo').setLabel('Motivazione Richiesta').setStyle(TextInputStyle.Paragraph).setRequired(true))
        );
        return await interaction.showModal(modal);
    }

    if (customId === 'doc_req_portodarmi') {
        const modal = new ModalBuilder().setCustomId('modal_doc_portodarmi').setTitle('Richiesta Porto d\'Armi');
        modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('nome_rp').setLabel('Nome e Cognome RP').setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('roblox_user').setLabel('Username Roblox Esatto').setStyle(TextInputStyle.Short).setRequired(true)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('motivo').setLabel('Motivazione e Uso Previsto').setStyle(TextInputStyle.Paragraph).setRequired(true))
        );
        return await interaction.showModal(modal);
    }
});

// Gestione Invio Moduli Documenti
client.on('interactionCreate', async interaction => {
    if (!interaction.isModalSubmit()) return;

    const { customId, user, guild } = interaction;

    if (customId.startsWith('modal_doc_')) {
        await interaction.deferReply({ ephemeral: true });

        const docType = customId === 'modal_doc_cittadinanza' ? 'Cittadinanza' : (customId === 'modal_doc_patente' ? 'Patente' : 'Porto d\'Armi');
        const nomeRp = interaction.fields.getTextInputValue('nome_rp');
        const robloxUser = interaction.fields.getTextInputValue('roblox_user');
        const dataNascita = customId === 'modal_doc_cittadinanza' ? interaction.fields.getTextInputValue('data_nascita') : null;
        const motivo = customId !== 'modal_doc_cittadinanza' ? interaction.fields.getTextInputValue('motivo') : null;

        const robloxData = await getRobloxUserData(robloxUser);
        const exactRoblox = robloxData ? robloxData.exactUsername : robloxUser;

        // 1. Invio DM all'utente "In Lavorazione"
        try {
            const dmEmbed = new EmbedBuilder()
                .setTitle(`📩 Richiesta ${docType} in Lavorazione`)
                .setDescription(`Gentile **${nomeRp}**, la tua richiesta per il documento **${docType}** è stata ricevuta ed è attualmente **in fase di revisione** da parte dello staff.`)
                .setColor('#F1C40F')
                .setThumbnail(GLOBAL_LOGO)
                .setFooter({ text: 'Stato Pratica: IN LAVORAZIONE' })
                .setTimestamp();

            await user.send({ embeds: [dmEmbed] });
        } catch (e) {
            console.log('Impossibile inviare DM all\'utente:', e);
        }

        // 2. Invia nel canale log specificato (1542488611470057516)
        const channel = guild.channels.cache.get(REQUESTS_CHANNEL_ID);
        if (channel) {
            const reqEmbed = new EmbedBuilder()
                .setTitle(`📑 NUOVA RICHIESTA: ${docType.toUpperCase()}`)
                .setColor('#3498DB')
                .setThumbnail(GLOBAL_LOGO)
                .addFields(
                    { name: '👤 Richiedente Discord', value: `${user} (\`${user.id}\`)`, inline: true },
                    { name: '🆔 Nome RP', value: nomeRp, inline: true },
                    { name: '🎮 Username Roblox', value: exactRoblox, inline: true }
                );

            if (dataNascita) reqEmbed.addFields({ name: '📅 Data di Nascita RP', value: dataNascita, inline: true });
            if (motivo) reqEmbed.addFields({ name: '📝 Motivazione', value: motivo, inline: false });

            reqEmbed.setFooter({ text: 'In attesa di approvazione dallo Staff' }).setTimestamp();

            const actions = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`approve_doc_${user.id}_${docType}_${encodeURIComponent(nomeRp)}_${encodeURIComponent(exactRoblox)}_${encodeURIComponent(dataNascita || 'N/D')}`).setLabel('Accetta').setStyle(ButtonStyle.Success).setEmoji('✅'),
                new ButtonBuilder().setCustomId(`deny_doc_${user.id}_${docType}`).setLabel('Rifiuta').setStyle(ButtonStyle.Danger).setEmoji('❌')
            );

            await channel.send({ embeds: [reqEmbed], components: [actions] });
        }

        return interaction.editReply({ content: `✅ La tua richiesta per **${docType}** è stata inviata con successo! Ti abbiamo inviato una conferma nei messaggi privati (DM).` });
    }

    // --- MODALI ARRESTO / MULTA / PERMAJAIL / PERMADEATH ---
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
                .setThumbnail(GLOBAL_LOGO)
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
                .setThumbnail(GLOBAL_LOGO)
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

    if (customId === 'modal_permajail') {
        await interaction.deferReply();
        const robloxUser = interaction.fields.getTextInputValue('roblox_user');
        const reason = interaction.fields.getTextInputValue('jail_reason');
        const customNotes = interaction.fields.getTextInputValue('jail_notes') || 'Nessuna nota aggiuntiva fornita.';

        const robloxData = await getRobloxUserData(robloxUser);
        if (!robloxData) return interaction.editReply({ content: '❌ Utente Roblox non trovato.' });

        wipeUserDatabase(robloxData.exactUsername);

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
            .setThumbnail(GLOBAL_LOGO)
            .addFields(
                { name: '👤 Detenuto', value: `**[${robloxData.exactUsername}](https://www.roblox.com/users/${robloxData.userId}/profile)**`, inline: true },
                { name: '👮 Agente / Giudice', value: `${user}`, inline: true },
                { name: '⏱️ Pena Comminata', value: '`ERGASTOLO (A Vita)`', inline: true },
                { name: '📜 Motivo / Reati Commessi', value: reason, inline: false },
                { name: '📝 Note Operative', value: customNotes, inline: false }
            )
            .setFooter({ text: 'Database Giudiziario — Registrazione Ergastolo' })
            .setTimestamp();

        await interaction.channel.send({ embeds: [permaJailEmbed] });
        return interaction.editReply({ content: `✅ **PermaJail** registrato per **${robloxData.exactUsername}**!`, ephemeral: true });
    }

    if (customId === 'modal_permadeath') {
        await interaction.deferReply();
        const robloxUser = interaction.fields.getTextInputValue('roblox_user');
        const reason = interaction.fields.getTextInputValue('death_reason');
        const customNotes = interaction.fields.getTextInputValue('death_notes') || 'Nessuna nota aggiuntiva fornita.';

        const robloxData = await getRobloxUserData(robloxUser);
        if (!robloxData) return interaction.editReply({ content: '❌ Utente Roblox non trovato.' });

        wipeUserDatabase(robloxData.exactUsername);

        const permaDeathEmbed = new EmbedBuilder()
            .setTitle('💀 VERBALE DI MORTE PERMANENTE (PERMADEATH)')
            .setColor('#000000')
            .setThumbnail(GLOBAL_LOGO)
            .addFields(
                { name: '👤 Soggetto Deceduto', value: `**[${robloxData.exactUsername}](https://www.roblox.com/users/${robloxData.userId}/profile)**`, inline: true },
                { name: '👮 Agente / Medico Accertatore', value: `${user}`, inline: true },
                { name: '⚰️ Stato Personaggio', value: '`DECEDUTO (PermaDeath)`', inline: true },
                { name: '📜 Motivo / Accaduto', value: reason, inline: false },
                { name: '📝 Note & Dettagli', value: customNotes, inline: false }
            )
            .setFooter({ text: 'Registro Anagrafico — Scheda Giudiziaria Resettata' })
            .setTimestamp();

        await interaction.channel.send({ embeds: [permaDeathEmbed] });
        return interaction.editReply({ content: `💀 **PermaDeath** inviata! Il database di **${robloxData.exactUsername}** è stato azzerato completamente.`, ephemeral: true });
    }
});

// Gestione Approvazione/Rifiuto Pratiche Documenti dallo Staff
client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;

    const { customId, user, message, guild } = interaction;

    if (customId.startsWith('approve_doc_') || customId.startsWith('deny_doc_')) {
        const parts = customId.split('_');
        const isApprove = parts[0] === 'approve';
        const userId = parts[2];
        const docType = parts[3];

        const targetUser = await client.users.fetch(userId).catch(() => null);

        if (isApprove) {
            const nomeRp = decodeURIComponent(parts[4]);
            const robloxUser = decodeURIComponent(parts[5]);
            const dataNascita = decodeURIComponent(parts[6]);

            // Salva nel Database
            const db = loadDatabase();

            if (docType === 'Cittadinanza') {
                db.cittadini = db.cittadini.filter(c => c.roblox_user.toLowerCase() !== robloxUser.toLowerCase());
                db.cittadini.push({
                    nome_rp: nomeRp,
                    data_nascita: dataNascita,
                    roblox_user: robloxUser,
                    data_registrazione: new Date().toLocaleDateString('it-IT')
                });
            } else {
                db.licenze.push({
                    roblox_user: robloxUser,
                    tipo: docType,
                    data: new Date().toLocaleDateString('it-IT')
                });
            }
            saveDatabase(db);

            // DM all'utente
            if (targetUser) {
                try {
                    const dmEmbed = new EmbedBuilder()
                        .setTitle(`🎉 Documento Approvato — ${docType}`)
                        .setDescription(`La tua richiesta per **${docType}** è stata **APPROVATA**!\nI tuoi dati sono stati registrati nella banca dati del Comune.`)
                        .setColor('#2ECC71')
                        .setThumbnail(GLOBAL_LOGO)
                        .setTimestamp();
                    await targetUser.send({ embeds: [dmEmbed] });
                } catch (e) {}
            }

            // Aggiorna Embed del canale log
            const oldEmbed = EmbedBuilder.from(message.embeds[0]);
            oldEmbed.setColor('#2ECC71');
            oldEmbed.setFooter({ text: `✅ Approvato da ${user.tag}` });

            await message.update({ embeds: [oldEmbed], components: [] });

        } else {
            // Se Rifiutato
            if (targetUser) {
                try {
                    const dmEmbed = new EmbedBuilder()
                        .setTitle(`❌ Documento Rifiutato — ${docType}`)
                        .setDescription(`La tua richiesta per **${docType}** è stata **RIFIUTATA** dallo staff.\nRivolgiti allo staff se desideri chiarimenti.`)
                        .setColor('#E74C3C')
                        .setThumbnail(GLOBAL_LOGO)
                        .setTimestamp();
                    await targetUser.send({ embeds: [dmEmbed] });
                } catch (e) {}
            }

            const oldEmbed = EmbedBuilder.from(message.embeds[0]);
            oldEmbed.setColor('#E74C3C');
            oldEmbed.setFooter({ text: `❌ Rifiutato da ${user.tag}` });

            await message.update({ embeds: [oldEmbed], components: [] });
        }
    }
});

// Gestione Pulsanti del Servizio Turni
client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;

    const { customId, user, guild, guildId } = interaction;
    if (!customId.startsWith('btn_')) return;

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
            logChannel.send({ embeds: [new EmbedBuilder().setTitle(`🟢 Inizio Servizio — ${reparto}`).setThumbnail(GLOBAL_LOGO).setColor('#2ECC71').setDescription(`L'operatore ${user} ha iniziato il turno.`).setTimestamp()] });
        }
    }

    if (action === 'pause') {
        if (!session) return interaction.reply({ content: '❌ Non sei in servizio!', ephemeral: true });
        if (session.state === 'PAUSED') return interaction.reply({ content: '⚠️ Servizio già in pausa!', ephemeral: true });

        session.state = 'PAUSED';
        session.pauseStartTime = Date.now();
        await interaction.reply({ content: `⏸️ **Servizio ${session.reparto} in pausa.**`, ephemeral: true });

        if (logChannel) {
            logChannel.send({ embeds: [new EmbedBuilder().setTitle(`⏸️ Pausa Servizio — ${session.reparto}`).setThumbnail(GLOBAL_LOGO).setColor('#F1C40F').setDescription(`L'operatore ${user} è in pausa.`).setTimestamp()] });
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
            logChannel.send({ embeds: [new EmbedBuilder().setTitle(`▶️ Ripresa Servizio — ${session.reparto}`).setThumbnail(GLOBAL_LOGO).setColor('#3498DB').setDescription(`L'operatore ${user} ha ripreso il turno.`).setTimestamp()] });
        }
    }

    if (action === 'stop') {
        if (!session) return interaction.reply({ content: '❌ Non sei in servizio!', ephemeral: true });

        const now = Date.now();
        let totalPause = session.totalPauseMs + (session.state === 'PAUSED' ? (now - session.pauseStartTime) : 0);
        const formattedTime = `${Math.floor((now - session.startTime - totalPause) / 3600000)}h ${Math.floor(((now - session.startTime - totalPause) % 3600000) / 60000)}m`;
        const currentReparto = session.reparto;

        activeSessions.delete(user.id);
        await interaction.reply({ content: `🔴 **Servizio ${currentReparto} terminato!** Durata effettiva: **${formattedTime}**.`, ephemeral: true });

        if (logChannel) {
            logChannel.send({ embeds: [new EmbedBuilder().setTitle(`🔴 Fine Servizio — ${currentReparto}`).setThumbnail(GLOBAL_LOGO).setColor('#E74C3C').setDescription(`L'operatore ${user} ha terminato il turno.`).addFields({ name: '⏱️ Tempo Effettivo', value: `\`${formattedTime}\`` }).setTimestamp()] });
        }
    }
});

client.login(token);
