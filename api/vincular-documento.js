import { config as carregarEnv } from "dotenv";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { createHash, createHmac } from "node:crypto";

if (process.env.NODE_ENV !== "production") {
    carregarEnv({ path: ".env.local", override: false });
}

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


const LIMITE_VINCULACAO = 5;
const JANELA_VINCULACAO_MS = 15 * 60 * 1000;

async function verificarLimiteVinculacao(uid) {
    const referencia = db.collection("limites_vinculacao").doc(uid);

    return db.runTransaction(async tx => {
        const registro = await tx.get(referencia);
        const agora = Date.now();
        const dados = registro.data();

        if (
            !registro.exists ||
            !Number.isFinite(dados.inicioJanela) ||
            agora - dados.inicioJanela >= JANELA_VINCULACAO_MS
        ) {
            tx.set(referencia, {
                inicioJanela: agora,
                tentativas: 1
            });

            return { permitido: true };
        }

        if (dados.tentativas >= LIMITE_VINCULACAO) {
            const segundos = Math.max(
                1,
                Math.ceil(
                    (JANELA_VINCULACAO_MS - (agora - dados.inicioJanela)) / 1000
                )
            );

            return { permitido: false, aguardar: segundos };
        }

        tx.update(referencia, {
            tentativas: dados.tentativas + 1
        });

        return { permitido: true };
    });
}

export default async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");

    if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        return res.status(405).json({
            erro: "Método não permitido."
        });
    }

    const segredo = process.env.DOCUMENT_HMAC_SECRET;

    if (!segredo || !/^[a-f0-9]{64}$/i.test(segredo)) {
        return res.status(503).json({
            erro: "Serviço temporariamente indisponível."
        });
    }

    const autorizacao = req.headers.authorization || "";

    if (!autorizacao.startsWith("Bearer ")) {
        return res.status(401).json({
            erro: "Autenticação obrigatória."
        });
    }

    let usuario;

    try {
        usuario = await getAuth().verifyIdToken(
            autorizacao.slice(7).trim(),
            true
        );
    } catch {
        return res.status(401).json({
            erro: "Sessão inválida ou expirada."
        });
    }

    if (!usuario.email || !usuario.email_verified) {
        return res.status(403).json({
            erro: "Confirme seu e-mail antes de continuar."
        });
    }

    let limite;

    try {
        limite = await verificarLimiteVinculacao(usuario.uid);
    } catch (erro) {
        console.error("Falha no controle de tentativas:", erro.code || "erro");

        return res.status(503).json({
            erro: "Serviço temporariamente indisponível."
        });
    }

    if (!limite.permitido) {
        res.setHeader("Retry-After", String(limite.aguardar));

        return res.status(429).json({
            erro: "Limite de tentativas atingido. Tente novamente mais tarde."
        });
    }

    const corpo = req.body || {};

    if (
        typeof corpo.cpfCnpj !== "string" ||
        typeof corpo.codigo !== "string"
    ) {
        return res.status(400).json({
            erro: "Dados de vinculação inválidos."
        });
    }

    const documento = corpo.cpfCnpj.replace(/\D/g, "");
    const codigo = corpo.codigo.trim();

    if (
        ![11, 14].includes(documento.length) ||
        codigo.length < 20 ||
        codigo.length > 128
    ) {
        return res.status(400).json({
            erro: "Dados de vinculação inválidos."
        });
    }

    const documentoHash = createHmac("sha256", segredo)
        .update(documento)
        .digest("hex");

    const codigoHash = createHash("sha256")
        .update(codigo)
        .digest("hex");

    const codigoRef = db.collection("codigosVinculacao")
        .doc(codigoHash);

    const vinculoRef = db.collection("documentosVinculados")
        .doc(documentoHash);

    const clienteRef = db.collection("clientes")
        .doc(usuario.uid);

    try {
        await db.runTransaction(async tx => {
            const [codigoDoc, vinculoDoc, clienteDoc] =
                await Promise.all([
                    tx.get(codigoRef),
                    tx.get(vinculoRef),
                    tx.get(clienteRef)
                ]);

            const permissao = codigoDoc.data();

            if (
                !codigoDoc.exists ||
                permissao?.documentoHash !== documentoHash ||
                permissao?.emailPermitido !== usuario.email.toLowerCase() ||
                permissao?.utilizado !== false ||
                ![undefined, "ativo"].includes(permissao?.estado) ||
                typeof permissao?.expiraEm?.toMillis !== "function" ||
                permissao.expiraEm.toMillis() <= Date.now()
            ) {
                throw new Error("VINCULO_NEGADO");
            }

            if (
                vinculoDoc.exists &&
                vinculoDoc.data().firebaseUid !== usuario.uid
            ) {
                throw new Error("VINCULO_NEGADO");
            }

            if (
                clienteDoc.exists &&
                clienteDoc.data().documentoHash &&
                clienteDoc.data().documentoHash !== documentoHash
            ) {
                throw new Error("VINCULO_NEGADO");
            }

            tx.set(vinculoRef, {
                firebaseUid: usuario.uid,
                documentoHash,
                email: usuario.email,
                atualizadoEm: FieldValue.serverTimestamp()
            });

            tx.set(clienteRef, {
                documentoHash,
                tipoDocumento: documento.length === 11
                    ? "CPF" : "CNPJ",
                documentoFinal: documento.slice(-4),
                email: usuario.email,
                emailVerificado: true,
                atualizadoEm: FieldValue.serverTimestamp()
            }, { merge: true });

            tx.update(codigoRef, {
                utilizado: true,
                utilizadoPor: usuario.uid,
                utilizadoEm: FieldValue.serverTimestamp()
            });
        });

        return res.status(200).json({
            sucesso: true,
            mensagem: "Documento vinculado com sucesso."
        });

    } catch (erro) {
        if (erro.message !== "VINCULO_NEGADO") {
            console.error("Falha interna na vinculação:", erro.code || "erro");
        }

        return res.status(400).json({
            erro: "Não foi possível validar o vínculo."
        });
    }
}
