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

// Lista negra de alucinações comuns do Whisper em silêncio
const HALLUCINATIONS = [
  "obrigado por assistir", "thanks for watching", "subtitles", "legenda",
  "inscreva-se", "subscribe", "boa sorte", "good luck", "você está lendo isso",
  "you reading this", "curtir", "like and share"
];

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

      // Transcrição sem inventar conversas
      const transcription = await openai.audio.transcriptions.create({
        file: fs.createReadStream(newPath),
        model: 'whisper-1',
        language: 'en',
        temperature: 0.0 // Zero criatividade no Whisper = menor chance de alucinação
      });

      if (fs.existsSync(newPath)) fs.unlinkSync(newPath);

      const textoIngles = transcription.text.trim();

      // Se não captou nada de útil ou captou pouquíssimas letras, descarta
      if (!textoIngles || textoIngles.length < 3) {
        return res.status(200).json({ traducao: "" });
      }

      // Tradução fiel ao que foi falado no jogo
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        max_tokens: 60,
        temperature: 0.1,
        messages: [
          {
            role: 'system',
            content: 'Você é um tradutor simultâneo de voz para voz em jogos online. Traduza o áudio em inglês diretamente para o português do Brasil. Traduza exatamente o que o jogador disse de forma natural e sem resumos. Se o texto for apenas ruído ou sem sentido, responda APENAS "VAZIO".'
          },
          {
            role: 'user',
            content: textoIngles
          }
        ],
      });

      let traducao = completion.choices[0].message.content.trim();

      // Filtro 1: Descarta respostas genéricas de ruído
      if (traducao.toUpperCase() === 'VAZIO') {
        return res.status(200).json({ traducao: "" });
      }

      // Filtro 2: Bloqueia alucinações do YouTube
      const textoLower = traducao.toLowerCase();
      const temAlucinacao = HALLUCINATIONS.some(h => textoLower.includes(h));
      if (temAlucinacao) {
        return res.status(200).json({ traducao: "" });
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
