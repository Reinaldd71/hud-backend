import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';
import fs from 'fs';
import tmp from 'tmp';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

wss.on('connection', (ws) => {
  console.log('Cliente conectado');

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);

      if (data.type === 'audio_chunk' && data.audio) {
        const audioBuffer = Buffer.from(data.audio, 'base64');

        // Cria o arquivo temporário
        const tempFile = tmp.fileSync({ postfix: '.webm' });
        fs.writeFileSync(tempFile.name, audioBuffer);

        // 1. Transcrição via Whisper
        let transcription;
        try {
          transcription = await openai.audio.transcriptions.create({
            file: fs.createReadStream(tempFile.name),
            model: 'whisper-1',
            language: 'en'
          });
        } catch (whisperErr) {
          tempFile.remove();
          throw new Error("Whisper OpenAI: " + whisperErr.message);
        }

        tempFile.remove();
        const textoIngles = transcription.text ? transcription.text.trim() : '';

        if (!textoIngles) {
          ws.send(JSON.stringify({ type: 'error', text: 'Sem áudio legível reconhecido' }));
          return;
        }

        // 2. Tradução via GPT-4o-mini
        let completion;
        try {
          completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            temperature: 0.2,
            messages: [
              {
                role: 'system',
                content: 'Traduza o texto em inglês a seguir diretamente para o português do Brasil de forma natural.'
              },
              { role: 'user', content: textoIngles }
            ]
          });
        } catch (gptErr) {
          throw new Error("GPT OpenAI: " + gptErr.message);
        }

        const traducao = completion.choices[0]?.message?.content?.trim();
        if (traducao) {
          ws.send(JSON.stringify({ type: 'translation', text: traducao }));
        } else {
          ws.send(JSON.stringify({ type: 'error', text: 'Resposta vazia da OpenAI' }));
        }
      }
    } catch (e) {
      console.error("ERRO COMPLETO:", e);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'error',
          text: e.message || 'Erro desconhecido no servidor'
        }));
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
