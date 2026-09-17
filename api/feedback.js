import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
  });
}

const db = getFirestore();

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      erro: "Método não permitido",
    });
  }

  const { texto } = req.body;

  if (!texto || !texto.trim()) {
    return res.status(400).json({
      erro: "Digite um feedback",
    });
  }

  try {
    const prompt = `
Analise o feedback abaixo:

"${texto}"

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

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": process.env.GEMINI_API_KEY,
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: prompt }],
            },
          ],
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("Erro Gemini:", data);

      return res.status(500).json({
        erro: "Erro ao acessar o Gemini",
      });
    }

    const resultado =
      data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!resultado) {
      throw new Error("Gemini não retornou uma resposta válida.");
    }

    const textoLimpo = resultado
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    const analise = JSON.parse(textoLimpo);

    await db.collection("feedbacks").add({
      texto,
      sentimento: analise.sentimento,
      categoria: analise.categoria,
      criadoEm: FieldValue.serverTimestamp(),
    });

    return res.status(200).json(analise);

  } catch (erro) {
    console.error("Erro:", erro);

    return res.status(500).json({
      erro: "Erro ao analisar feedback",
    });
  }
}