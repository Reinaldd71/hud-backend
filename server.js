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

// Filtro robusto com remoção de pontuação e sem limite arbitrário de tamanho
function ehAlucinacao(texto) {
  if (!texto || texto.length < 2) return true;
  
  // Remove pontuações e converte para minúsculas
  const textoLimpo = texto.toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?'"]/g, "").trim();
  const palavras = textoLimpo.split(/\s+/).filter(p => p.length > 0);

  if (palavras.length === 0) return true;

  // 1. Checa repetição de palavras simples consecutivas (ex: "you you you")
  if (palavras.length > 3) {
    let consecutivas = 0;
    for (let i = 1; i < palavras.length; i++) {
      if (palavras[i] === palavras[i - 1]) consecutivas++;
    }
    if (consecutivas / palavras.length > 0.3) return true;
  }

  // 2. Checa repetição de frases de 2 palavras (ex: "what what", "o que o que")
  if (palavras.length >= 4) {
    const pares = [];
    for (let i = 0; i < palavras.length - 1; i += 2) {
      pares.push(`${palavras[i]} ${palavras[i + 1]}`);
    }
    let paresRepetidos = 0;
    for (let i = 1; i < pares.length; i++) {
      if (pares[i] === pares[i - 1]) paresRepetidos++;
    }
    if (pares.length > 1 && paresRepetidos / pares.length >= 0.5) return true;
  }

  return false;
}

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
          language: 'en',
          prompt: 'In-game voice chat.'
        });

        const textoIngles = transcription.text ? transcription.text.trim() : '';

        // Descarta transcrições vazias ou alucinadas
        if (!textoIngles || ehAlucinacao(textoIngles)) {
          console.log("Áudio ignorado (silêncio ou alucinação):", textoIngles);
          return;
        }

        // 2. Tradução via GPT-4o-mini
        const completion = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          temperature: 0.2,
          messages: [
            { 
              role: 'system', 
              content: 'Traduza o áudio de voz do jogo em inglês para o português do Brasil. Traduza de forma direta e concisa.' 
            },
            { role: 'user', content: textoIngles }
          ]
        });

        const traducao = completion.choices[0]?.message?.content?.trim();
        if (traducao && !ehAlucinacao(traducao)) {
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
