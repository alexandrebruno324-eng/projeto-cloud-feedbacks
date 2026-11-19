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

    const authorization = req.headers.authorization || "";

    if (!authorization.startsWith("Bearer ")) {
        return res.status(401).json({
            erro: "Autenticação obrigatória."
        });
    }

    let usuario;

    try {
        usuario = await getAuth().verifyIdToken(
            authorization.slice(7).trim(),
            true
        );
    } catch {
        return res.status(401).json({
            erro: "Sessão inválida ou expirada."
        });
    }

    if (!usuario.email || !usuario.email_verified) {
        return res.status(403).json({
            erro: "Confirme seu e-mail para continuar."
        });
    }

    try {
        // Preserva as encomendas anteriores.
        const antigas = await db.collection("encomendas")
            .where("clienteUid", "==", usuario.uid)
            .limit(100)
            .get();

        const encontradas = new Map();

        for (const doc of antigas.docs) {
            encontradas.set(doc.id, doc);
        }

        // Confere o vínculo nos dois sentidos.
        const clienteDoc = await db.collection("clientes")
            .doc(usuario.uid)
            .get();

        const hash = clienteDoc.data()?.documentoHash;

        if (typeof hash === "string" &&
            /^[a-f0-9]{64}$/i.test(hash)) {

            const vinculoDoc = await db
                .collection("documentosVinculados")
                .doc(hash)
                .get();

            if (
                vinculoDoc.exists &&
                vinculoDoc.data().firebaseUid === usuario.uid &&
                clienteDoc.data().email?.toLowerCase() ===
                    usuario.email.toLowerCase() &&
                vinculoDoc.data().email?.toLowerCase() ===
                    usuario.email.toLowerCase()
            ) {
                const novas = await db.collection("encomendas")
                    .where("documentoHash", "==", hash)
                    .limit(100)
                    .get();

                for (const doc of novas.docs) {
                    encontradas.set(doc.id, doc);
                }
            }
        }

        const encomendas = Array.from(encontradas.values())
            .map(doc => {
                const dados = doc.data();

                return {
                    id: doc.id,
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
        console.error("Erro ao consultar encomendas:", erro.code || "erro");

        return res.status(500).json({
            erro: "Não foi possível consultar suas encomendas."
        });
    }
}
