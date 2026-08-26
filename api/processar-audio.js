import formidable from 'formidable';
import fs from 'fs';
import OpenAI from 'openai';

// Configuração para desativar o parser padrão da Vercel para uploads
export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  // Configuração de CORS para permitir requisições do seu HTML
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido. Use POST.' });
  }

  const form = formidable({ keepExtensions: true });

  form.parse(req, async (err, fields, files) => {
    if (err) {
      console.error('Erro no upload do arquivo:', err);
      return res.status(500).json({ error: 'Erro no processamento do áudio.' });
    }

    const audioFile = files.audio?.[0] || files.audio;
    if (!audioFile) {
      return res.status(400).json({ error: 'Nenhum áudio foi enviado.' });
    }

    try {
      const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });

      // 1. Transcrição com Whisper
      const transcription = await openai.audio.transcriptions.create({
        file: fs.createReadStream(audioFile.filepath),
        model: 'whisper-1',
        language: 'en',
      });

      const textoIngles = transcription.text ? transcription.text.trim() : "";

      // Se não detectou fala clara, retorna vazio
      if (!textoIngles || textoIngles.length < 2) {
        return res.status(200).json({ traducao: "" });
      }

      // 2. Tradução Tática Direta com GPT-4o-mini
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `Você é um HUD de tradução simultânea em tempo real para um jogador de FPS/tático. 
Sua única função é traduzir o áudio de voz recebido do inglês para o português de forma ultra direta, viva e natural, como jogada falada no Discord/Ventrilo.

Regras absolutas:
1. Retorne APENAS a tradução em português.
2. Não adicione explicações, notas, aspas ou prefixos.
3. Se a frase for ruído ou incompreensível, não responda nada (retorne vazio).
4. Mantenha os termos táticos conhecidos (ex: push, flank, rush, clutch, reload, revive) quando fizer sentido no contexto dos gamers brasileiros.`
          },
          {
            role: 'user',
            content: textoIngles
          }
        ],
        temperature: 0.3,
        max_tokens: 60,
      });

      const traducao = completion.choices[0]?.message?.content?.trim() || "";

      return res.status(200).json({ traducao });

    } catch (error) {
      console.error('Erro na API OpenAI:', error);
      return res.status(500).json({ error: 'Erro ao processar na OpenAI.' });
    } finally {
      // Limpa o arquivo temporário
      if (audioFile.filepath && fs.existsSync(audioFile.filepath)) {
        fs.unlinkSync(audioFile.filepath);
      }
    }
  });
}