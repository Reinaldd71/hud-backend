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
    if (err) return res.status(500).json({ error: 'Erro ao processar áudio' });

    try {
      const audioFile = files.audio?.[0] || files.audio;
      if (!audioFile) return res.status(400).json({ error: 'Arquivo ausente' });

      const oldPath = audioFile.filepath;
      const newPath = `${oldPath}.webm`;
      fs.renameSync(oldPath, newPath);

      // 1. Transcrição guiada para evitar alucinações de ruído
      const transcription = await openai.audio.transcriptions.create({
        file: fs.createReadStream(newPath),
        model: 'whisper-1',
        language: 'en',
        prompt: 'In-game voice chat, Arc Raiders, FPS tactical calls, player conversation.', // Força o Whisper a focar em termos de jogo
      });

      if (fs.existsSync(newPath)) fs.unlinkSync(newPath);

      const textoIngles = transcription.text.trim();

      // Se a transcrição for muito curta, sem sentido ou apenas barulho, descarta
      if (!textoIngles || textoIngles.length < 4) {
        return res.status(200).json({ traducao: "" });
      }

      // 2. Tradução focada em contexto de jogo
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        max_tokens: 40,
        temperature: 0.2,
        messages: [
          {
            role: 'system',
            content: 'Você é um tradutor de chat de voz de jogos FPS (Arc Raiders). Traduza o áudio em inglês para português brasileiro natural e direto. Se o texto for ruído ou sem sentido, responda APENAS com a palavra "IGNORE".'
          },
          {
            role: 'user',
            content: textoIngles
          }
        ],
      });

      let traducao = completion.choices[0].message.content.trim();

      if (traducao.toUpperCase().includes('IGNORE')) {
        traducao = "";
      }

      return res.status(200).json({ 
        original: textoIngles,
        traducao: traducao 
      });

    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Erro na API' });
    }
  });
}
