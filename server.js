import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
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


wss.on('connection', (ws) => {

    console.log('Celular conectado.');

    ws.on('message', async (message) => {

        try {

            const data = JSON.parse(message);

            if (
                data.type !== 'audio_chunk' ||
                !data.audio
            ) {
                return;
            }


            const audioBuffer =
                Buffer.from(
                    data.audio,
                    'base64'
                );


            console.log(
                `Áudio recebido: ${audioBuffer.length} bytes`
            );


            /*
            Envia o áudio para o Whisper
            */

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

                    language: 'en',

                    prompt:
                        'English voice chat between players in a multiplayer video game.'

                });


            const textoIngles =
                transcription.text
                    ? transcription.text.trim()
                    : '';


            console.log(
                'Whisper:',
                textoIngles
            );


            /*
            Se não houver fala,
            simplesmente ignora.
            */

            if (!textoIngles) {
                return;
            }


            /*
            Tradução
            */

            const completion =
                await openai.chat.completions.create({

                    model: 'gpt-4o-mini',

                    temperature: 0.1,

                    messages: [

                        {
                            role: 'system',

                            content: `
Você é um tradutor de voz para jogadores de videogames multiplayer.

Traduza qualquer fala humana em inglês para português brasileiro.

A tradução deve ser rápida, natural e fácil de ler durante uma partida.

Interprete gírias, expressões informais e linguagem de jogadores pelo contexto.

Não faça tradução literal quando isso prejudicar o significado.

Preserve nomes próprios, nomes de jogadores, armas, itens e termos específicos quando apropriado.

Priorize o significado da fala.

Responda SOMENTE com a tradução em português.

Não escreva o texto original.

Não explique.

Não acrescente comentários.

Não escreva "tradução:".
`
                        },

                        {
                            role: 'user',

                            content: textoIngles

                        }

                    ]

                });


            const traducao =
                completion
                    .choices[0]
                    ?.message
                    ?.content
                    ?.trim();


            console.log(
                'Tradução:',
                traducao
            );


            if (
                traducao &&
                ws.readyState === WebSocket.OPEN
            ) {

                ws.send(
                    JSON.stringify({

                        type: 'translation',

                        text: traducao

                    })
                );

            }

        } catch (error) {

            console.error(
                'ERRO:',
                error
            );


            if (
                ws.readyState === WebSocket.OPEN
            ) {

                ws.send(
                    JSON.stringify({

                        type: 'error',

                        text:
                            'Erro ao processar áudio.'

                    })
                );

            }

        }

    });


    ws.on('close', () => {

        console.log(
            'Celular desconectado.'
        );

    });

});


const PORT =
    process.env.PORT || 3000;


server.listen(
    PORT,
    () => {

        console.log(
            `Servidor rodando na porta ${PORT}`
        );

    }
);
