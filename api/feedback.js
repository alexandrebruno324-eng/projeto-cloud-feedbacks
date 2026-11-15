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

// Não renderizar diretamente texto enviado pelo usuário dentro de HTML.
function escaparHtml(valor) {
  return String(valor)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ erro: "Método não permitido" });
  }

  const texto = req.body?.texto;
  if (typeof texto !== "string" || !texto.trim()) {
    return res.status(400).json({ erro: "Digite um feedback" });
  }
  if (texto.length > 2000) {
    return res.status(400).json({ erro: "Limite de 2000 caracteres excedido" });
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
          contents: [{ parts: [{ text: prompt }] }],
        }),
      }
    );

    const data = await response.json();
    if (!response.ok) {
      console.error("Erro Gemini:", data);
      return res.status(502).json({ erro: "Erro ao acessar o Gemini" });
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
    if (!["positivo", "negativo", "neutro"].includes(analise.sentimento)) {
      throw new Error("Sentimento inválido retornado pelo Gemini.");
    }

    await db.collection("feedbacks").add({
      texto,
      sentimento: analise.sentimento,
      categoria: analise.categoria,
      criadoEm: FieldValue.serverTimestamp(),
    });

    let alertaEmail = "nao_aplicavel";
    if (analise.sentimento === "negativo") {
      const destinatario = process.env.ALERT_EMAIL_TO?.trim();
      const remetente =
        process.env.RESEND_FROM_EMAIL?.trim() ||
        "Feedback Cloud <onboarding@resend.dev>";

      if (!resend || !destinatario) {
        alertaEmail = "nao_configurado";
        console.warn(
          "Alerta de e-mail não configurado. Confira RESEND_API_KEY e ALERT_EMAIL_TO."
        );
      } else {
        try {
          const { data: emailData, error: emailError } =
            await resend.emails.send({
              from: remetente,
              to: destinatario,
              subject: "Novo feedback negativo - Cloud Feedbacks",
              html: `
                <h2>Feedback negativo recebido</h2>
                <p><strong>Feedback:</strong> ${escaparHtml(texto).replace(/\n/g, "<br>")}</p>
                <p><strong>Categoria:</strong> ${escaparHtml(analise.categoria)}</p>
                <p><strong>Sentimento:</strong> ${escaparHtml(analise.sentimento)}</p>
              `,
            });

          if (emailError || !emailData?.id) {
            alertaEmail = "falha";
            console.error("Falha Resend:", {
              name: emailError?.name || "Resposta sem ID",
              message: emailError?.message || "Nenhum ID retornado",
              statusCode: emailError?.statusCode || null,
            });
          } else {
            alertaEmail = "aceito";
            console.info("Resend aceitou o e-mail. ID:", emailData.id);
          }
        } catch (erroEmail) {
          alertaEmail = "falha";
          console.error("Erro inesperado do Resend:", erroEmail);
        }
      }
    }

    return res.status(200).json({ ...analise, alertaEmail });
  } catch (erro) {
    console.error("Erro ao analisar feedback:", erro);
    return res.status(500).json({ erro: "Erro ao analisar feedback" });
  }
}
