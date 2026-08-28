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
PROCESSAMENTO DO ÁUDIO
=========================================================
*/

async function processarAudio(ws, audioBase64, sequence) {

    try {

        const audioBuffer = Buffer.from(
            audioBase64,
            'base64'
        );


        /*
        Converte o áudio recebido em arquivo WAV
        */

        const file = await toFile(
            audioBuffer,
            `audio-${sequence}.wav`,
            {
                type: 'audio/wav'
            }
        );


        /*
        =================================================
        WHISPER
        =================================================
        */

        const transcription =
            await openai.audio.transcriptions.create({

                file: file,

                model: 'whisper-1',

                language: 'en',

                prompt:
                    'English multiplayer video game voice chat.'

            });


        const textoIngles =
            transcription.text
                ? transcription.text.trim()
                : '';


        /*
        IMPORTANTE:

        Mesmo quando não existe fala,
        enviamos uma resposta para que a fila
        do celular nunca fique bloqueada.
        */

        if (!textoIngles) {

            if (ws.readyState === WebSocket.OPEN) {

                ws.send(JSON.stringify({

                    type: 'empty',

                    sequence: sequence

                }));

            }

            return;
        }


        /*
        =================================================
        GPT
        =================================================
        */

        const completion =
            await openai.chat.completions.create({

                model: 'gpt-4o-mini',

                temperature: 0.1,

                messages: [

                    {
                        role: 'system',

                        content: `
Você é um tradutor rápido de comunicação entre jogadores de videogame.

Traduza do inglês para português brasileiro.

Seu objetivo é permitir que o jogador entenda rapidamente o que outro jogador está dizendo durante uma partida.

REGRAS:

Responda somente com a tradução.

Não explique.

Não repita o inglês.

Não acrescente informações.

Não invente contexto.

Interprete gírias e expressões de jogadores pelo contexto.

Preserve nomes próprios, nomes de jogadores, itens e termos específicos quando necessário.

Priorize o significado da comunicação.

Se a frase estiver incompleta, traduza somente o que foi entendido.

Se a fala for curta, mantenha a tradução curta.

Não transforme uma fala curta em uma explicação.
`
                    },

                    {
                        role: 'user',

                        content: textoIngles

                    }

                ]

            });


        const traducao =
            completion.choices[0]?.message?.content
                ?.trim() || '';


        /*
        =================================================
        ENVIA RESULTADO PARA O CELULAR
        =================================================
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


        /*
        Mesmo em caso de erro,
        liberamos a sequência.
        */

        if (ws.readyState === WebSocket.OPEN) {

            ws.send(JSON.stringify({

                type: 'error',

                sequence: sequence,

                text: 'Erro ao processar este bloco.'

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

    console.log(
        'Celular conectado ao servidor.'
    );


    ws.on('message', async (message) => {

        try {

            const data =
                JSON.parse(message);


            if (
                data.type === 'audio_chunk' &&
                data.audio &&
                typeof data.sequence === 'number'
            ) {

                /*
                NÃO usamos await.

                Isso permite que vários blocos
                sejam processados simultaneamente.
                */

                processarAudio(
                    ws,
                    data.audio,
                    data.sequence
                );

            }

        } catch (error) {

            console.error(
                'Erro recebendo áudio:',
                error
            );

        }

    });


    ws.on('close', () => {

        console.log(
            'Celular desconectado.'
        );

    });

});


/*
=========================================================
SERVIDOR
=========================================================
*/

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
