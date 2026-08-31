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
FILTRO DE TRANSCRIÇÕES PROBLEMÁTICAS
=========================================================
*/

function ehTranscricaoRuim(texto) {

    if (!texto) return true;

    const t = texto
        .trim()
        .toLowerCase();

    if (t.length < 2) return true;


    /*
    Frases muito características de vídeos,
    que não fazem sentido em comunicação de jogadores.
    */

    const frasesSuspeitas = [

        'thanks for watching',
        'thank you for watching',
        'thanks for watching this video',
        'thank you for watching this video',
        'see you in the next video',
        'see you next time',
        'subscribe to my channel',
        'like and subscribe',
        'don\'t forget to subscribe',
        'welcome to my channel',
        'this is the end of the video',
        'that\'s the end of the video',
        'special thanks',
        'thanks for watching guys',
        'have a great day',
        'have a good day',
        'thanks for listening'

    ];


    for (const frase of frasesSuspeitas) {

        if (t.includes(frase)) {

            console.log(
                'Transcrição descartada:',
                texto
            );

            return true;

        }

    }


    /*
    Detecta repetição exagerada.
    Exemplo:
    what what what what what
    */

    const palavras =
        t
            .replace(/[.,!?;:"']/g, '')
            .split(/\s+/)
            .filter(Boolean);


    if (palavras.length >= 5) {

        let repeticoes = 0;

        for (
            let i = 1;
            i < palavras.length;
            i++
        ) {

            if (
                palavras[i] ===
                palavras[i - 1]
            ) {

                repeticoes++;

            }

        }


        if (
            repeticoes >=
            palavras.length * 0.5
        ) {

            console.log(
                'Transcrição repetitiva descartada:',
                texto
            );

            return true;

        }

    }


    return false;

}


/*
=========================================================
CONEXÃO DO CELULAR
=========================================================
*/

wss.on('connection', (ws) => {

    console.log(
        'Celular conectado.'
    );


    ws.on('message', async (message) => {

        try {

            const data =
                JSON.parse(message);


            if (
                data.type !== 'audio_chunk' ||
                !data.audio
            ) {

                return;

            }


            /*
            =================================================
            RECEBE ÁUDIO
            =================================================
            */

            const audioBuffer =
                Buffer.from(
                    data.audio,
                    'base64'
                );


            console.log(
                `Áudio recebido: ${audioBuffer.length} bytes`
            );


            /*
            =================================================
            WHISPER
            =================================================
            */

            const file =
                await toFile(
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


            /*
            =================================================
            DESCARTA ÁUDIO SEM FALA
            =================================================
            */

            if (
                ehTranscricaoRuim(
                    textoIngles
                )
            ) {

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
Você traduz comunicação de voz entre jogadores de videogames multiplayer.

Traduza qualquer fala humana em inglês para português brasileiro.

A fala pode conter gírias, abreviações, linguagem informal, erros de pronúncia ou termos usados por jogadores.

Interprete o significado pelo contexto.

Não faça uma tradução excessivamente literal quando isso prejudicar o significado da comunicação.

Mantenha nomes próprios, nomes de jogadores, armas, equipamentos, itens e termos específicos do jogo quando apropriado.

Se uma palavra ou expressão parecer ser um nome próprio ou termo específico de videogame, não invente uma tradução.

Se a frase estiver incompleta, traduza somente o significado que estiver claramente presente.

Responda SOMENTE com a tradução em português brasileiro.

Não escreva o texto original.

Não explique.

Não acrescente comentários.

Não escreva "tradução:".

Não invente informações que não estejam presentes na fala.
`
                        },

                        {
                            role: 'user',

                            content:
                                textoIngles

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
                'GPT:',
                traducao
            );


            /*
            =================================================
            ENVIA PARA O CELULAR
            =================================================
            */

            if (
                traducao &&
                ws.readyState ===
                WebSocket.OPEN
            ) {

                ws.send(

                    JSON.stringify({

                        type:
                            'translation',

                        text:
                            traducao

                    })

                );

            }

        } catch (error) {

            console.error(
                'ERRO NO SERVIDOR:',
                error
            );


            if (
                ws.readyState ===
                WebSocket.OPEN
            ) {

                ws.send(

                    JSON.stringify({

                        type:
                            'error',

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
