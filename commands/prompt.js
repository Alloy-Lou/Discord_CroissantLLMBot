const { SlashCommandBuilder } = require('discord.js');
//const { EmbedBuilder } = require('discord.js');
const { ApplicationCommandType, EmbedBuilder, Client, CommandInteraction } = require("discord.js");
const { time, TimestampStyles } = require('discord.js');


let isLLMBusy = false;

module.exports = {
    /**
   * 
   * @param {Client} client - The Discord client instance
   * @param {CommandInteraction} interaction - The interaction object
   */
    data: new SlashCommandBuilder()
        .setName('prompt')
        .setDescription("Discutez avec CroissantLLM")
        .addStringOption(option =>
            option.setName('prompt')
                .setDescription('Votre texte')
                .setRequired(true)),

    async execute(interaction) {
        if (isLLMBusy) {
            return await interaction.reply({ 
                content: "❌ L'IA est actuellement occupée à générer une autre réponse. Veuillez ré-essayer dans un moment...", 
                ephemeral: true
            });
        }

        isLLMBusy = true;

        await interaction.deferReply();

        const userPrompt = interaction.options.getString('prompt');
        const OLLAMA_URL = 'http://localhost:11434/api/generate';

        const embed = new EmbedBuilder()
            .setColor('#f09d3e')
            .setAuthor({
                name: interaction.member.nickname,
                iconURL: interaction.member.avatarURL()
            })
            .setTitle(userPrompt.substring(0, 1024))
            .setDescription('...')
            //.addField("Génération de la réponse en cours...", `Dernière mise à jour : ${time(new Date().now(), TimestampStyles.RelativeTime)}`)
        
        let fullResponse = '';
        let lastSentResponse = '';
        let intervalId = null;

        try {
            const response = await fetch(OLLAMA_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: 'croissant',
                    prompt: userPrompt,
                    stream: true
                })
            });

            if (!response.ok) {
                throw new Error(`Ollama a répondu avec le status ${response.status}`);
            }

            // 5s Discord update loop
            intervalId = setInterval(async () => {
                // Only update if text has actually changed and isn't empty
                if (fullResponse !== lastSentResponse && fullResponse.trim().length > 0) {
                    lastSentResponse = fullResponse;

                    const now = new Date();
                    const nextUpdate = new Date(Date.now() + 5000);
                    embed.setDescription(fullResponse.substring(0, 4000))
                        .setFields([{ 
                            name: "Génération de la réponse en cours...",
                            value: `Dernière mise à jour : ${time(now, TimestampStyles.RelativeTime)}\
                            \nProchaine mise à jour : ${time(nextUpdate, TimestampStyles.RelativeTime)}`
                        }])

                    try {
                        // Discord messages are capped at 2000 characters
                        await interaction.editReply({ embeds: [embed] });
                    } catch (discordError) {
                        console.error('Error editing Discord message during stream:', discordError);
                    }
                }
            }, 5000); // 5s

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                // Accumulate binary stream buffer chunks into text lines
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                
                // Keep the last element in the buffer if it's a partial line
                buffer = lines.pop(); 

                for (const line of lines) {
                    if (line.trim() === '') continue;
                    
                    try {
                        // Ollama outputs NdJSON (Newline Delimited JSON)
                        const parsedLine = JSON.parse(line);
                        if (parsedLine.response) {
                            fullResponse += parsedLine.response;
                        }
                    } catch (jsonError) {
                        console.error('Error parsing stream line:', jsonError);
                    }
                }
            }

            // Check if there's any leftover text in the buffer at the end
            if (buffer.trim().length > 0) {
                try {
                    const parsedLine = JSON.parse(buffer);
                    if (parsedLine.response) fullResponse += parsedLine.response;
                } catch (e) {}
            }

        } catch (error) {
            console.error('Ollama Streaming Error:', error);
            fullResponse = "⚠️ Désolé, une erreur est survenue lors de la communication avec CroissantLLM";
        } finally {
            if (intervalId) clearInterval(intervalId);

            try {
                embed.setDescription(finalOutput.substring(0, 4000))
                     .setFields([]) // Strips out the countdown metadata cleanly
                     .setColor('#2ECC71'); // Green for complete

                await interaction.editReply({ embeds: [embed] });
            } catch (finalDiscordError) {
                console.error('Error sending final response edit:', finalDiscordError);
            }

            isLLMBusy = false;
        }
    },
};