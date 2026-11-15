
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
            erro: "Faça login para consultar suas encomendas."
        });
    }

    const token = autorizacao.slice(7).trim();

    if (!token) {
        return res.status(401).json({
            erro: "Token de autenticação não informado."
        });
    }

    try {
        const usuario = await getAuth().verifyIdToken(token, true);

        if (!usuario.email_verified) {
            return res.status(403).json({
                erro: "Confirme seu e-mail para acessar suas encomendas."
            });
        }

        const resultado = await db
            .collection("encomendas")
            .where("clienteUid", "==", usuario.uid)
            .limit(100)
            .get();

        const encomendas = resultado.docs.map((documento) => {
            const dados = documento.data();

            return {
                id: documento.id,
                codigo: dados.codigo || "",
                status: dados.status || "",
                origem: dados.origem || "",
                destino: dados.destino || "",
                previsaoEntrega: dados.previsaoEntrega || "",
                entregue: dados.entregue === true,
                avaliada: dados.avaliada === true
            };
        });

        encomendas.sort((a, b) =>
            a.codigo.localeCompare(b.codigo, "pt-BR")
        );

        return res.status(200).json({
            sucesso: true,
            total: encomendas.length,
            encomendas
        });
    } catch (erro) {
        if (
            erro.code?.startsWith("auth/") ||
            erro.code === "app/invalid-credential"
        ) {
            return res.status(401).json({
                erro: "Sua sessão é inválida ou expirou. Entre novamente."
            });
        }

        console.error("Erro ao consultar encomendas:", erro);

        return res.status(500).json({
            erro: "Não foi possível consultar suas encomendas."
        });
    }
}
