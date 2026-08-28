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
  console.log('Cliente conectado ao VAD HUD');

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);

      if (data.type === 'audio_chunk' && data.audio) {
        const audioBuffer = Buffer.from(data.audio, 'base64');

        // Cria arquivo temporário para enviar à OpenAI
        const tempFile = tmp.fileSync({ postfix: '.webm' });
        fs.writeFileSync(tempFile.name, audioBuffer);

        // 1. Transcrição do áudio enviado após a pausa natural
        const transcription = await openai.audio.transcriptions.create({
          file: fs.createReadStream(tempFile.name),
          model: 'whisper-1',
          language: 'en'
        });

        tempFile.remove();

        const textoIngles = transcription.text ? transcription.text.trim() : '';

        // Filtra alucinações de silêncio do Whisper
        if (textoIngles.length > 2 && !textoIngles.toLowerCase().includes('subtitles')) {
          // 2. Tradução direta do contexto sem regras rígidas
          const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            temperature: 0.2,
            messages: [
              {
                role: 'system',
                content: 'Você é um tradutor simultâneo. Traduza a fala em inglês a seguir diretamente para o português do Brasil. Mantenha o tom natural e direto.'
              },
              { role: 'user', content: textoIngles }
            ]
          });

          const traducao = completion.choices[0].message.content.trim();
          ws.send(JSON.stringify({ type: 'translation', text: traducao }));
        }
      }
    } catch (e) {
      console.error("Erro no processamento do bloco:", e.message);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor VAD rodando na porta ${PORT}`);
});
