import express from 'express';
import { WebSocketServer } from 'ws';
import http from 'http';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI, { toFile } from 'openai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

function enviarStatus(ws, texto) {
    if (ws.readyState === 1) {
        ws.send(JSON.stringify({
            type: 'diagnostico',
            text: texto
        }));
    }
}

wss.on('connection', (ws) => {

    console.log('CELULAR CONECTADO');

    enviarStatus(ws, '🟢 SERVIDOR CONECTADO');

    ws.on('message', async (message) => {

        try {

            const data = JSON.parse(message);

            if (data.type !== 'audio_chunk' || !data.audio) {
                return;
            }

            const audioBuffer = Buffer.from(data.audio, 'base64');

            console.log(
                'ÁUDIO RECEBIDO:',
                audioBuffer.length,
                'bytes'
            );

            enviarStatus(
                ws,
                `📥 ÁUDIO RECEBIDO: ${Math.round(audioBuffer.length / 1024)} KB`
            );

            if (audioBuffer.length < 1000) {
                enviarStatus(ws, '⚠️ ÁUDIO MUITO PEQUENO');
                return;
            }

            enviarStatus(ws, '🎧 ENVIANDO PARA WHISPER...');

            const file = await toFile(
                audioBuffer,
                'audio.webm',
                {
                    type: 'audio/webm'
                }
            );

            const transcription =
                await openai.audio.transcriptions.create({
                    file: file,
                    model: 'whisper-1',
                    language: 'en'
                });

            const textoIngles =
                transcription.text
                    ? transcription.text.trim()
                    : '';

            console.log(
                'WHISPER:',
                textoIngles
            );

            if (!textoIngles) {
                enviarStatus(
                    ws,
                    '⚠️ WHISPER NÃO IDENTIFICOU FALA'
                );
                return;
            }

            enviarStatus(
                ws,
                `📝 WHISPER: ${textoIngles}`
            );

            enviarStatus(
                ws,
                '🤖 ENVIANDO PARA GPT...'
            );

            const completion =
                await openai.chat.completions.create({

                    model: 'gpt-4o-mini',

                    temperature: 0.2,

                    messages: [

                        {
                            role: 'system',

                            content:
                                'Você é um tradutor de voz para jogos multiplayer. ' +
                                'Traduza a fala em inglês para português brasileiro. ' +
                                'Preserve o sentido e as gírias naturais de jogos. ' +
                                'Seja direto e conciso. ' +
                                'Responda somente com a tradução.'
                        },

                        {
                            role: 'user',
                            content: textoIngles
                        }

                    ]
                });

            const traducao =
                completion.choices[0]?.message?.content?.trim();

            console.log(
                'TRADUÇÃO:',
                traducao
            );

            if (!traducao) {
                enviarStatus(
                    ws,
                    '⚠️ GPT NÃO RETORNOU TRADUÇÃO'
                );
                return;
            }

            enviarStatus(
                ws,
                '🇧🇷 TRADUÇÃO PRONTA'
            );

            ws.send(JSON.stringify({
                type: 'translation',
                text: traducao
            }));

        } catch (e) {

            console.error(
                'ERRO COMPLETO:',
                e
            );

            enviarStatus(
                ws,
                '❌ ERRO: ' + (
                    e.message ||
                    'Erro desconhecido'
                )
            );

        }

    });

    ws.on('close', () => {
        console.log('CELULAR DESCONECTADO');
    });

});

const PORT =
    process.env.PORT || 3000;

server.listen(PORT, () => {

    console.log(
        `Servidor rodando na porta ${PORT}`
    );

});
