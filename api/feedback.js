import { GoogleGenAI } from "@google/genai";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import serviceAccount from "../Firebase-key.json" with { type: "json" };

initializeApp({
  credential: cert(serviceAccount)
});

const db = getFirestore();

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ erro: "Método não permitido" });
  }

  const { texto } = req.body;

  if (!texto) {
    return res.status(400).json({ erro: "Digite um feedback" });
  }

  try {
    const prompt = `
Analise o feedback abaixo.

Feedback: "${texto}"

Classifique o sentimento como:
positivo, negativo ou neutro.

Classifique a categoria como uma destas:
Atendimento
Entrega/Logística
Qualidade do Produto
Preço/Pagamento
Usabilidade do Sistema
Outros

Responda SOMENTE em JSON neste formato:
{
  "sentimento": "positivo",
  "categoria": "Atendimento"
}
`;

    const response = await ai.models.generateContent({
      model: "gemini-3.6-flash",
      contents: prompt,
    });

    const resultado = response.text
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    const analise = JSON.parse(resultado);

await db.collection("feedbacks").add({
  texto: texto,
  sentimento: analise.sentimento,
  categoria: analise.categoria,
  criadoEm: FieldValue.serverTimestamp()
});

return res.status(200).json(analise);

  } catch (erro) {
    console.error(erro);

    return res.status(500).json({
      erro: "Erro ao analisar feedback"
    });
  }
}