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

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

wss.on('connection', (ws) => {
  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);

      if (data.type === 'audio_chunk' && data.audio) {
        const audioBuffer = Buffer.from(data.audio, 'base64');
        const file = await toFile(audioBuffer, 'input.webm', { type: 'audio/webm' });

        // 1. Transcrição via Whisper
        const transcription = await openai.audio.transcriptions.create({
          file: file,
          model: 'whisper-1',
          language: 'en'
        });

        const textoIngles = transcription.text ? transcription.text.trim() : '';

        // Se não detectou palavras reais em inglês, ignora
        if (!textoIngles) return;

        // 2. Tradução via GPT-4o-mini
        const completion = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          temperature: 0.2,
          messages: [
            { role: 'system', content: 'Traduza o texto em inglês a seguir diretamente para o português do Brasil de forma natural e fluida.' },
            { role: 'user', content: textoIngles }
          ]
        });

        const traducao = completion.choices[0]?.message?.content?.trim();
        if (traducao) {
          ws.send(JSON.stringify({ type: 'translation', text: traducao }));
        }
      }
    } catch (e) {
      console.error("ERRO NO SERVIDOR:", e);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'error', text: 'Erro no servidor: ' + e.message }));
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
