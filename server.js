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
========================================================
FILTRO DE ALUCINAÇÃO
========================================================
*/

function limparTexto(texto) {
  return texto
    .toLowerCase()
    .replace(/[.,!?;:'"()[\]{}\-_/\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}


function ehRepetitivo(texto) {

  const limpo = limparTexto(texto);

  if (!limpo) return true;

  const palavras = limpo.split(' ');

  if (palavras.length < 4) {
    return false;
  }

  /*
  Repetição consecutiva:

  "goop goop goop goop"
  "what what what what"
  */

  let repeticoes = 0;

  for (let i = 1; i < palavras.length; i++) {

    if (palavras[i] === palavras[i - 1]) {
      repeticoes++;
    }

  }

  if (repeticoes >= 3) {
    return true;
  }


  /*
  Verifica uma palavra/frase que aparece
  muitas vezes no texto.
  */

  const contagem = {};

  for (const palavra of palavras) {
    contagem[palavra] = (contagem[palavra] || 0) + 1;
  }

  const maiorRepeticao = Math.max(...Object.values(contagem));

  if (
    palavras.length >= 8 &&
    maiorRepeticao / palavras.length > 0.45
  ) {
    return true;
  }

  return false;
}


/*
========================================================
ANÁLISE DA TRANSCRIÇÃO DO WHISPER
========================================================
*/

function analisarTranscricao(transcription) {

  const texto = transcription?.text?.trim() || '';

  if (!texto) {

    return {
      aceita: false,
      motivo: 'Transcrição vazia'
    };

  }


  /*
  O Whisper pode devolver segmentos contendo:

  no_speech_prob
  avg_logprob
  compression_ratio

  Esses indicadores ajudam a identificar
  silêncio, ruído e alucinações.
  */

  const segmentos = Array.isArray(transcription.segments)
    ? transcription.segments
    : [];


  /*
  Se houver segmentos, analisamos a confiança.
  */

  if (segmentos.length > 0) {

    let possuiFalaReal = false;

    for (const segmento of segmentos) {

      const noSpeech = Number(segmento.no_speech_prob);
      const logProb = Number(segmento.avg_logprob);
      const compression = Number(segmento.compression_ratio);


      /*
      Segmento claramente reconhecido como fala.
      */

      if (
        !Number.isNaN(noSpeech) &&
        noSpeech < 0.65
      ) {

        /*
        Log probability muito baixa indica
        transcrição pouco confiável.
        */

        if (
          Number.isNaN(logProb) ||
          logProb > -1.25
        ) {

          /*
          Compression ratio muito alto é
          um indicador clássico de repetição/alucinação.
          */

          if (
            Number.isNaN(compression) ||
            compression < 2.8
          ) {

            possuiFalaReal = true;
            break;

          }

        }

      }

    }


    if (!possuiFalaReal) {

      return {
        aceita: false,
        motivo: 'Baixa confiança de fala'
      };

    }

  }


  /*
  Filtro textual adicional.
  */

  if (ehRepetitivo(texto)) {

    return {
      aceita: false,
      motivo: 'Texto repetitivo'
    };

  }


  /*
  Evita textos absurdamente grandes,
  que normalmente indicam alucinação.
  */

  if (texto.length > 500) {

    return {
      aceita: false,
      motivo: 'Texto excessivamente longo'
    };

  }


  return {
    aceita: true,
    motivo: 'Fala válida'
  };

}


/*
========================================================
FILA POR CONEXÃO
========================================================

Evita que vários áudios sejam processados
simultaneamente e cheguem atrasados ao celular.
*/

wss.on('connection', (ws) => {

  console.log('Celular conectado ao servidor.');

  let fila = [];
  let processando = false;


  async function processarFila() {

    if (processando) return;

    processando = true;

    while (
      fila.length > 0 &&
      ws.readyState === WebSocket.OPEN
    ) {

      const audioBase64 = fila.shift();

      try {

        /*
        ==================================================
        1. RECEBE O ÁUDIO
        ==================================================
        */

        const audioBuffer = Buffer.from(
          audioBase64,
          'base64'
        );


        /*
        Proteção contra arquivos absurdamente pequenos.
        Não bloqueamos arquivos normais de fala curta.
        */

        if (audioBuffer.length < 3000) {

          console.log(
            'Áudio muito pequeno ignorado:',
            audioBuffer.length,
            'bytes'
          );

          continue;

        }


        /*
        ==================================================
        2. ENVIA PARA WHISPER
        ==================================================
        */

        const file = await toFile(
          audioBuffer,
          'input.webm',
          {
            type: 'audio/webm'
          }
        );


        const transcription =
          await openai.audio.transcriptions.create({

            file: file,

            model: 'whisper-1',

            language: 'en',

            response_format: 'verbose_json',

            temperature: 0

          });


        const textoIngles =
          transcription?.text?.trim() || '';


        console.log(
          'WHISPER:',
          textoIngles
        );


        /*
        ==================================================
        3. FILTRO DE CONFIANÇA
        ==================================================
        */

        const analise =
          analisarTranscricao(transcription);


        if (!analise.aceita) {

          console.log(
            'WHISPER IGNORADO:',
            analise.motivo,
            '|',
            textoIngles
          );

          continue;

        }


        /*
        ==================================================
        4. ENVIA PARA GPT
        ==================================================
        */

        const completion =
          await openai.chat.completions.create({

            model: 'gpt-4o-mini',

            temperature: 0.1,

            messages: [

              {
                role: 'system',

                content: `
Você é um tradutor de voz para jogadores de Arc Raiders.

Sua única função é traduzir uma fala REAL em inglês para português brasileiro.

REGRAS ABSOLUTAS:

1. Traduza somente o texto recebido.
2. Não invente nenhuma informação.
3. Não complete frases que não estejam no texto.
4. Não crie contexto.
5. Não acrescente frases.
6. Não responda ao jogador.
7. Não converse com o usuário.
8. Não transforme a tradução em explicação.
9. Não adicione saudações.
10. Não adicione despedidas.
11. Não adicione "obrigado por assistir".
12. Não adicione informações que não estejam na fala original.
13. Preserve nomes próprios e termos do jogo quando apropriado.
14. Seja natural em português brasileiro.
15. Seja conciso.

Exemplo:

Inglês:
"Can you give me that blueprint?"

Português:
"Você pode me dar esse projeto?"

Retorne SOMENTE a tradução.
`
              },

              {
                role: 'user',
                content: textoIngles
              }

            ]

          });


        const traducao =
          completion?.choices?.[0]?.message?.content?.trim() || '';


        /*
        ==================================================
        5. PROTEÇÕES FINAIS
        ==================================================
        */

        if (!traducao) {

          console.log(
            'GPT não retornou tradução.'
          );

          continue;

        }


        if (ehRepetitivo(traducao)) {

          console.log(
            'TRADUÇÃO IGNORADA: texto repetitivo.'
          );

          continue;

        }


        /*
        ==================================================
        6. ENVIA AO CELULAR
        ==================================================
        */

        if (ws.readyState === WebSocket.OPEN) {

          ws.send(
            JSON.stringify({

              type: 'translation',

              text: traducao

            })
          );

        }

      } catch (erro) {

        console.error(
          'ERRO AO PROCESSAR ÁUDIO:',
          erro
        );


        if (
          ws.readyState === WebSocket.OPEN
        ) {

          ws.send(
            JSON.stringify({

              type: 'error',

              text: 'Erro ao processar áudio.'

            })
          );

        }

      }

    }

    processando = false;

  }


  /*
  ========================================================
  RECEBIMENTO DOS ÁUDIOS
  ========================================================
  */

  ws.on('message', (message) => {

    try {

      const data =
        JSON.parse(message);


      if (
        data.type === 'audio_chunk' &&
        data.audio
      ) {

        /*
        Coloca o áudio na fila.
        */

        fila.push(data.audio);


        /*
        Inicia o processamento.
        */

        processarFila();

      }

    } catch (erro) {

      console.error(
        'Erro ao interpretar mensagem:',
        erro
      );

    }

  });


  /*
  ========================================================
  ENCERRAMENTO
  ========================================================
  */

  ws.on('close', () => {

    console.log(
      'Celular desconectado.'
    );

    fila = [];

  });

});


/*
========================================================
SERVIDOR
========================================================
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
