import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';

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
  console.log('Celular conectado ao servidor!');

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      
      if (data.type === 'text' && data.text.trim()) {
        const completion = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          temperature: 0.1,
          messages: [
            {
              role: 'system',
              content: 'Você é um tradutor simultâneo para Arc Raiders. Traduza o texto em inglês diretamente para português do Brasil. Use termos corretos de games (loot = saque, blueprint = projeto de arma, keycard = cartão de acesso). Seja direto e sem firulas.'
            },
            {
              role: 'user',
              content: data.text
            }
          ]
        });

        const traducao = completion.choices[0].message.content.trim();
        ws.send(JSON.stringify({ type: 'translation', original: data.text, text: traducao }));
      }
    } catch (e) {
      console.error("Erro ao traduzir:", e);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
