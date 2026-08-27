import formidable from 'formidable';
import fs from 'fs';
import OpenAI from 'openai';

export const config = {
  api: {
    bodyParser: false,
  },
};

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const form = formidable({});
  
  form.parse(req, async (err, fields, files) => {
    if (err) {
      return res.status(500).json({ error: 'Erro ao processar o áudio' });
    }

    try {
      const audioFile = files.audio?.[0] || files.audio;
      if (!audioFile) {
        return res.status(400).json({ error: 'Nenhum arquivo de áudio enviado' });
      }

      // 1. Transcrição rápida com Whisper
      const transcription = await openai.audio.transcriptions.create({
        file: fs.createReadStream(audioFile.filepath),
        model: 'whisper-1',
        language: 'en',
      });

      const textoIngles = transcription.text;

      // Se não detectou fala ou foi só ruído, responde vazio na hora
      if (!textoIngles || textoIngles.trim().length < 3) {
        return res.status(200).json({ traducao: "" });
      }

      // 2. Tradução ultra-rápida resumida em modo gamer/HUD
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        max_tokens: 30, // Limite curto para resposta instantânea
        temperature: 0.1, // Menos "criatividade", mais velocidade
        messages: [
          {
            role: 'system',
            content: 'Você é um HUD de tradução para jogos. Traduza o áudio em inglês para o português de forma EXTREMAMENTE CURTA, direta e usando palavras-chave. Ignorar conversas fiadas. Máximo de 3 a 5 palavras. Exemplo: Inimigo na esquerda, Precisando de munição, Vamos recuar.'
          },
          {
            role: 'user',
            content: textoIngles
          }
        ],
      });

      const traducao = completion.choices[0].message.content.trim();

      return res.status(200).json({ 
        original: textoIngles,
        traducao: traducao 
      });

    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Erro ao comunicar com a OpenAI' });
    }
  });
}
