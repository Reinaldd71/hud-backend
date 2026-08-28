import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

wss.on('connection', (ws) => {
  console.log('Cliente conectado ao HUD');

  // Abre conexão em tempo real com a OpenAI Realtime API
  const url = "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01";
  const openAiWs = new WebSocket(url, {
    headers: {
      "Authorization": "Bearer " + process.env.OPENAI_API_KEY,
      "OpenAI-Beta": "realtime=v1",
    },
  });

  openAiWs.on('open', () => {
    // Configura as instruções do tradutor em tempo real
    const sessionUpdate = {
      type: "session.update",
      session: {
        modalities: ["text"],
        instructions: "Você é um tradutor simultâneo de voz para jogos online (Arc Raiders/FPS). Traduza o áudio em inglês que receber IMEDIATAMENTE para português do Brasil em tempo real. Seja direto, use gírias gamer apropriadas (loot = saque, blueprint = projeto, enemy = inimigo). Nunca invente frases em momentos de silêncio.",
        input_audio_format: "pcm16",
        output_audio_format: "pcm16",
        turn_detection: {
          type: "server_vad",
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 500
        }
      }
    };
    openAiWs.send(JSON.stringify(sessionUpdate));
  });

  // Recebe mensagens de áudio da tela do celular e repassa para a OpenAI
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      if (data.type === 'audio' && openAiWs.readyState === WebSocket.OPEN) {
        openAiWs.send(JSON.stringify({
          type: 'input_audio_buffer.append',
          audio: data.audio
        }));
      }
    } catch (e) {
      console.error("Erro ao repassar áudio:", e);
    }
  });

  // Recebe a tradução em tempo real da OpenAI e envia para o celular
  openAiWs.on('message', (data) => {
    try {
      const response = JSON.parse(data.toString());
      
      if (response.type === 'response.text.delta' && response.delta) {
        ws.send(JSON.stringify({ type: 'text_chunk', text: response.delta }));
      } else if (response.type === 'response.text.done') {
        ws.send(JSON.stringify({ type: 'text_done' }));
      }
    } catch (e) {
      console.error("Erro na resposta da OpenAI:", e);
    }
  });

  ws.on('close', () => {
    if (openAiWs.readyState === WebSocket.OPEN) openAiWs.close();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor de Streaming rodando na porta ${PORT}`);
});
