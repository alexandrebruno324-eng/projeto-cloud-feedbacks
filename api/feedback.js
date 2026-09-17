import { Resend } from "resend";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

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

    const GEMINI_MODEL = "gemini-3.5-flash-lite";

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
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

    const resultado = data.candidates?.[0]?.content?.parts?.[0]?.text;

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

    if (analise.sentimento === "negativo" && resend) {
      try {
        const { data: emailData, error: emailError } =
          await resend.emails.send({
            from: "Feedback Cloud <onboarding@resend.dev>",
            to: "alexandrebruno324@gmail.com",
            subject: "🚨 Novo feedback negativo",
            html: `
              <h2>Feedback negativo recebido</h2>
              <p><strong>Feedback:</strong> ${texto}</p>
              <p><strong>Categoria:</strong> ${analise.categoria}</p>
              <p><strong>Sentimento:</strong> ${analise.sentimento}</p>
            `,
          });

        if (emailError) {
          console.error("Erro Resend (não bloqueante):", emailError);
        } else {
          console.log("E-mail enviado:", emailData?.id);
        }
      } catch (emailErro) {
        console.error("Falha inesperada ao enviar e-mail:", emailErro);
      }
    }

    return res.status(200).json(analise);
  } catch (erro) {
    console.error("Erro:", erro);
    return res.status(500).json({
      erro: "Erro ao analisar feedback",
    });
  }
}
