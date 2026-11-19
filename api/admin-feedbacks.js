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
            erro: "Autenticação obrigatória."
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

        const administrador = await db
            .collection("administradores")
            .doc(usuario.uid)
            .get();

        if (
            !administrador.exists ||
            administrador.data().ativo !== true
        ) {
            return res.status(403).json({
                erro: "Acesso restrito à administração da BRN."
            });
        }

        const resultado = await db
            .collection("feedbacks")
            .orderBy("criadoEm", "desc")
            .limit(100)
            .get();

        const idsEncomendas = [...new Set(
            resultado.docs
                .map(doc => doc.data().encomendaId)
                .filter(id => typeof id === "string" && id.length > 0)
        )];

        const referencias = idsEncomendas.map(id =>
            db.collection("encomendas").doc(id)
        );

        const documentosEncomendas = referencias.length
            ? await db.getAll(...referencias)
            : [];

        const rastreamentos = new Map(
            documentosEncomendas
                .filter(doc => doc.exists)
                .map(doc => [
                    doc.id,
                    doc.data().codigo || doc.data().codigoRastreamento || null
                ])
        );

        const feedbacks = resultado.docs.map((documento) => {
            const dados = documento.data();

            return {
                id: documento.id,
                encomendaId: dados.encomendaId || null,
                codigoRastreamento: rastreamentos.get(dados.encomendaId) || null,
                clienteUid: dados.clienteUid || null,
                texto: dados.texto || "",
                sentimento: dados.sentimento || "",
                categoria: dados.categoria || "",
                criadoEm: dados.criadoEm?.toDate?.()?.toISOString() || null
            };
        });

        return res.status(200).json({
            sucesso: true,
            total: feedbacks.length,
            feedbacks
        });

    } catch (erro) {
        if (erro.code?.startsWith("auth/")) {
            return res.status(401).json({
                erro: "Sessão inválida ou expirada."
            });
        }

        console.error("Erro no painel administrativo:", erro.message);

        return res.status(500).json({
            erro: "Não foi possível consultar os feedbacks."
        });
    }
}
