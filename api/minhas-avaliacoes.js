import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

if (!getApps().length) {
    initializeApp({
        credential: cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n")
        })
    });
}

const db = getFirestore();

export default async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");

    if (req.method !== "GET") {
        res.setHeader("Allow", "GET");
        return res.status(405).json({
            erro: "Método não permitido."
        });
    }

    const autorizacao = req.headers.authorization || "";

    if (!autorizacao.startsWith("Bearer ")) {
        return res.status(401).json({
            erro: "Faça login para consultar suas avaliações."
        });
    }

    try {
        const token = autorizacao.slice(7).trim();
        const usuario = await getAuth().verifyIdToken(token, true);

        if (!usuario.email_verified) {
            return res.status(403).json({
                erro: "Confirme seu e-mail para continuar."
            });
        }

        const resultado = await db
            .collection("feedbacks")
            .where("clienteUid", "==", usuario.uid)
            .limit(100)
            .get();

        const avaliacoes = resultado.docs
            .map((documento) => {
                const dados = documento.data();

                return {
                    id: documento.id,
                    encomendaId: dados.encomendaId || null,
                    texto: dados.texto || "",
                    sentimento: dados.sentimento || "",
                    categoria: dados.categoria || "",
                    criadoEm: dados.criadoEm?.toDate?.()?.toISOString() || null
                };
            })
            .filter((avaliacao) => avaliacao.encomendaId);

        avaliacoes.sort((a, b) =>
            (b.criadoEm || "").localeCompare(a.criadoEm || "")
        );

        return res.status(200).json({
            sucesso: true,
            total: avaliacoes.length,
            avaliacoes
        });

    } catch (erro) {
        if (erro.code?.startsWith("auth/")) {
            return res.status(401).json({
                erro: "Sessão inválida ou expirada."
            });
        }

        console.error("Erro ao consultar avaliações:", erro.message);

        return res.status(500).json({
            erro: "Não foi possível consultar suas avaliações."
        });
    }
}
