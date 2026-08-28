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
  console.log('Cliente celular conectado!');

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    ws.send(JSON.stringify({ type: 'text_chunk', text: ' [ERRO: Adicione OPENAI_API_KEY no Render] ' }));
    return;
  }

  // Conexão com o modelo Realtime da OpenAI
  const url = "wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01";
  const openAiWs = new WebSocket(url, {
    headers: {
      "Authorization": "Bearer " + apiKey,
      "OpenAI-Beta": "realtime=v1",
    },
  });

  openAiWs.on('open', () => {
    console.log('Sessão OpenAI iniciada com sucesso!');
    
    // Configura os parâmetros do tradutor
    const sessionUpdate = {
      type: "session.update",
      session: {
        modalities: ["text"],
        instructions: "Você é um tradutor simultâneo de voz para jogos online. Traduza todo o áudio em inglês recebido imediatamente para o português do Brasil. Traduza com precisão, mantendo termos de games (loot = saque, blueprint = projeto). Não gere respostas se não houver voz.",
        input_audio_format: "pcm16",
        turn_detection: {
          type: "server_vad",
          threshold: 0.4,
          prefix_padding_ms: 300,
          silence_duration_ms: 400
        }
      }
    };
    openAiWs.send(JSON.stringify(sessionUpdate));
  });

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      if (data.type === 'audio' && openAiWs.readyState === WebSocket.OPEN) {
        // Envia o chunk de áudio PCM16 em Base64 recebido do microfone
        openAiWs.send(JSON.stringify({
          type: 'input_audio_buffer.append',
          audio: data.audio
        }));
      }
    } catch (e) {
      console.error("Erro ao processar pacote de áudio:", e);
    }
  });

  openAiWs.on('message', (data) => {
    try {
      const response = JSON.parse(data.toString());

      // Captura o texto que a OpenAI gera em tempo real
      if (response.type === 'response.audio_transcript.delta' && response.delta) {
        ws.send(JSON.stringify({ type: 'text_chunk', text: response.delta }));
      } else if (response.type === 'response.text.delta' && response.delta) {
        ws.send(JSON.stringify({ type: 'text_chunk', text: response.delta }));
      } else if (response.type === 'response.done') {
        ws.send(JSON.stringify({ type: 'text_done' }));
      }
    } catch (e) {
      console.error("Erro ao ler resposta da OpenAI:", e);
    }
  });

  openAiWs.on('error', (err) => {
    console.error("Erro na comunicação com a OpenAI:", err.message);
    ws.send(JSON.stringify({ type: 'text_chunk', text: ' [Erro na API Realtime da OpenAI] ' }));
  });

  ws.on('close', () => {
    if (openAiWs.readyState === WebSocket.OPEN) openAiWs.close();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor ativo na porta ${PORT}`);
});
