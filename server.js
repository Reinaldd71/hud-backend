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
  console.log('Cliente conectado');

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);

      if (data.type === 'audio_chunk' && data.audio) {
        ws.send(JSON.stringify({ type: 'step', text: '📥 SERVER: Áudio recebido no Render!' }));

        const audioBuffer = Buffer.from(data.audio, 'base64');
        const file = await toFile(audioBuffer, 'input.webm', { type: 'audio/webm' });

        ws.send(JSON.stringify({ type: 'step', text: '🤖 WHISPER: Enviando áudio para transcrição...' }));

        // 1. Transcrição
        const transcription = await openai.audio.transcriptions.create({
          file: file,
          model: 'whisper-1',
          language: 'en'
        });

        const textoIngles = transcription.text ? transcription.text.trim() : '';
        ws.send(JSON.stringify({ type: 'step', text: `🎧 INGLÊS: "${textoIngles || 'Nenhuma palavra detectada'}"` }));

        if (!textoIngles) return;

        // 2. Tradução
        ws.send(JSON.stringify({ type: 'step', text: '🇧🇷 GPT: Traduzindo para português...' }));

        const completion = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          temperature: 0.2,
          messages: [
            { role: 'system', content: 'Traduza o texto em inglês para o português do Brasil.' },
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
        ws.send(JSON.stringify({ type: 'error', text: 'ERRO SERVIDOR: ' + e.message }));
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
