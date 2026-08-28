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


/*
=========================================================
PROCESSAMENTO DE UM BLOCO DE ÁUDIO
=========================================================
*/

async function processarAudio(ws, audioBase64, sequence) {

    try {

        const audioBuffer = Buffer.from(audioBase64, 'base64');

        const file = await toFile(
            audioBuffer,
            `audio-${sequence}.wav`,
            {
                type: 'audio/wav'
            }
        );


        /*
        =====================================================
        1. TRANSCRIÇÃO
        =====================================================
        */

        const transcription = await openai.audio.transcriptions.create({
            file: file,
            model: 'whisper-1',
            language: 'en',
            prompt: 'English multiplayer game voice chat.'
        });

        const textoIngles = transcription.text
            ? transcription.text.trim()
            : '';


        if (!textoIngles || textoIngles.length < 2) {
            return;
        }


        /*
        =====================================================
        ENVIA STATUS PARA O CELULAR
        =====================================================
        */

        if (ws.readyState === WebSocket.OPEN) {

            ws.send(JSON.stringify({
                type: 'transcription',
                sequence: sequence,
                text: textoIngles
            }));

        }


        /*
        =====================================================
        2. TRADUÇÃO
        =====================================================
        */

        const completion = await openai.chat.completions.create({

            model: 'gpt-4o-mini',

            temperature: 0.1,

            messages: [

                {
                    role: 'system',

                    content: `
Você é um tradutor extremamente rápido de comunicação entre jogadores de videogame.

Traduza do inglês para português brasileiro.

OBJETIVO PRINCIPAL:
Entregar rapidamente o significado que um jogador precisa entender durante uma partida.

REGRAS:

1. Responda somente com a tradução.
2. Não explique nada.
3. Não repita o inglês.
4. Preserve nomes próprios e nomes de itens quando fizer sentido.
5. Interprete gírias de jogadores pelo contexto.
6. Não faça uma tradução excessivamente literal quando isso prejudicar o significado.
7. Seja curto e natural.
8. Não invente informações que não estejam na fala.
9. Se a frase estiver incompleta, traduza somente o que foi entendido.
10. Não transforme uma fala curta em uma frase longa.
`
                },

                {
                    role: 'user',
                    content: textoIngles
                }

            ]

        });


        const traducao =
            completion.choices[0]?.message?.content?.trim();


        if (!traducao) {
            return;
        }


        /*
        =====================================================
        DEVOLVE A TRADUÇÃO
        =====================================================
        */

        if (ws.readyState === WebSocket.OPEN) {

            ws.send(JSON.stringify({

                type: 'translation',

                sequence: sequence,

                original: textoIngles,

                text: traducao

            }));

        }


    } catch (error) {

        console.error(
            `Erro no bloco ${sequence}:`,
            error
        );

        if (ws.readyState === WebSocket.OPEN) {

            ws.send(JSON.stringify({

                type: 'error',

                sequence: sequence,

                text: 'Erro ao processar áudio.'

            }));

        }

    }

}


/*
=========================================================
WEBSOCKET
=========================================================
*/

wss.on('connection', (ws) => {

    console.log('Celular conectado.');


    ws.on('message', async (message) => {

        try {

            const data = JSON.parse(message);


            if (
                data.type === 'audio_chunk' &&
                data.audio &&
                typeof data.sequence === 'number'
            ) {

                /*
                NÃO usamos await aqui.

                Cada bloco pode ser processado
                independentemente dos outros.
                */

                processarAudio(
                    ws,
                    data.audio,
                    data.sequence
                );

            }

        } catch (error) {

            console.error(
                'Erro recebendo mensagem:',
                error
            );

        }

    });


    ws.on('close', () => {

        console.log('Celular desconectado.');

    });

});


/*
=========================================================
SERVIDOR
=========================================================
*/

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {

    console.log(
        `Servidor rodando na porta ${PORT}`
    );

});
