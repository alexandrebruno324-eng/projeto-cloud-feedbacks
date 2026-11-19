import { Resend } from "resend";
import { config as carregarEnv } from "dotenv";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { randomBytes, createHash } from "node:crypto";

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
const INTERVALO_REENVIO = 2 * 60 * 1000;

export default async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");

    if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
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

    let administrador;

    try {
        administrador = await getAuth().verifyIdToken(
            autorizacao.slice(7).trim(), true
        );
    } catch {
        return res.status(401).json({
            erro: "Sessão inválida ou expirada."
        });
    }

    if (!administrador.email_verified) {
        return res.status(403).json({
            erro: "Confirme seu e-mail."
        });
    }

    try {
        const permissao = await db.collection("administradores")
            .doc(administrador.uid).get();

        if (!permissao.exists || permissao.data().ativo !== true) {
            return res.status(403).json({
                erro: "Acesso restrito aos administradores."
            });
        }

        const codigoRastreamento =
            typeof req.body?.codigoRastreamento === "string"
                ? req.body.codigoRastreamento.trim()
                : "";

        if (!/^BRN-\d{4}-\d{6,}$/.test(codigoRastreamento)) {
            return res.status(400).json({
                erro: "Código de rastreamento inválido."
            });
        }

        const consulta = await db.collection("encomendas")
            .where("codigo", "==", codigoRastreamento)
            .limit(2)
            .get();

        if (consulta.size !== 1) {
            return res.status(404).json({
                erro: "Encomenda não encontrada."
            });
        }

        const encomendaRef = consulta.docs[0].ref;
        const encomenda = consulta.docs[0].data();

        if (
            typeof encomenda.documentoHash !== "string" ||
            !/^[a-f0-9]{64}$/i.test(encomenda.documentoHash) ||
            typeof encomenda.emailContato !== "string" ||
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(encomenda.emailContato)
        ) {
            return res.status(409).json({
                erro: "A encomenda não permite reenvio automático."
            });
        }

        const chaveResend = process.env.RESEND_API_KEY;
        const remetente = process.env.RESEND_FROM_EMAIL?.trim();

        if (!chaveResend || !remetente) {
            return res.status(503).json({
                erro: "Serviço de e-mail não configurado."
            });
        }

        const codigoSecreto = randomBytes(32).toString("hex");
        const codigoHash = createHash("sha256")
            .update(codigoSecreto)
            .digest("hex");

        const novoCodigoRef = db.collection("codigosVinculacao")
            .doc(codigoHash);

        const consultaCodigos = db.collection("codigosVinculacao")
            .where("encomendaId", "==", encomendaRef.id)
            .limit(101);

        const identificador = randomBytes(16).toString("hex");
        const agora = Date.now();
        const expiraReserva = new Date(agora + 2 * 60 * 1000);
        const expiraCodigo = new Date(agora + 7 * 24 * 60 * 60 * 1000);

        await db.runTransaction(async tx => {
            const atual = await tx.get(encomendaRef);

            if (!atual.exists) {
                throw new Error("REENVIO_BLOQUEADO");
            }

            const dados = atual.data();

            if (
                dados.documentoHash !== encomenda.documentoHash ||
                dados.emailContato !== encomenda.emailContato
            ) {
                throw new Error("REENVIO_BLOQUEADO");
            }

            const ultimo = dados.ultimoReenvioVinculacao?.toMillis?.();
            const pendente = dados.reenvioPendente;
            const reserva = pendente?.expiraEm?.toMillis?.();

            if (
                (ultimo && Date.now() - ultimo < INTERVALO_REENVIO) ||
                (reserva && reserva > Date.now())
            ) {
                throw new Error("REENVIO_FREQUENTE");
            }

            let codigoAntigoRef = null;
            let codigoAntigoDoc = null;

            if (pendente) {
                if (
                    typeof reserva !== "number" ||
                    typeof pendente.codigoHash !== "string" ||
                    !/^[a-f0-9]{64}$/i.test(pendente.codigoHash)
                ) {
                    throw new Error("REENVIO_BLOQUEADO");
                }

                codigoAntigoRef = db.collection("codigosVinculacao")
                    .doc(pendente.codigoHash);

                codigoAntigoDoc = await tx.get(codigoAntigoRef);

                if (
                    !codigoAntigoDoc.exists ||
                    codigoAntigoDoc.data().encomendaId !== encomendaRef.id ||
                    codigoAntigoDoc.data().documentoHash !== dados.documentoHash
                ) {
                    throw new Error("REENVIO_BLOQUEADO");
                }
            }

            if (
                codigoAntigoDoc?.data().estado === "pendente"
            ) {
                tx.update(codigoAntigoRef, {
                    estado: "cancelado",
                    utilizado: true,
                    canceladoEm: FieldValue.serverTimestamp()
                });
            }

            tx.create(novoCodigoRef, {
                documentoHash: dados.documentoHash,
                emailPermitido: dados.emailContato,
                encomendaId: encomendaRef.id,
                utilizado: false,
                estado: "pendente",
                expiraEm: expiraCodigo,
                criadoEm: FieldValue.serverTimestamp()
            });

            tx.update(encomendaRef, {
                reenvioPendente: {
                    id: identificador,
                    codigoHash,
                    expiraEm: expiraReserva
                }
            });
        });

        let envioAceito = false;

        try {
            const resend = new Resend(chaveResend);

            const resultado = await resend.emails.send({
                from: remetente,
                to: encomenda.emailContato,
                subject: "BRN Transportes - Novo código de vinculação",
                text: [
                    "Olá!",
                    "",
                    "Um novo código de vinculação foi solicitado.",
                    `Rastreamento: ${codigoRastreamento}`,
                    `Código secreto: ${codigoSecreto}`,
                    "",
                    "Acesse a Área do Cliente da BRN.",
                    "O código expira em 7 dias e só pode ser usado uma vez.",
                    "",
                    "Se não reconhece esta solicitação, contate a BRN."
                ].join("\n")
            });

            envioAceito = !resultado.error && !!resultado.data?.id;

            if (!envioAceito) {
                console.error(
                    "Resend recusou o reenvio:",
                    resultado.error?.name || "resposta_invalida"
                );
            }
        } catch (erroEmail) {
            console.error(
                "Falha no envio:",
                erroEmail.name || "erro"
            );
        }

        if (!envioAceito) {
            await db.runTransaction(async tx => {
                const atual = await tx.get(encomendaRef);

                if (
                    atual.exists &&
                    atual.data().reenvioPendente?.id === identificador &&
                    atual.data().reenvioPendente?.codigoHash === codigoHash
                ) {
                    tx.update(novoCodigoRef, {
                        estado: "cancelado",
                        utilizado: true,
                        canceladoEm: FieldValue.serverTimestamp()
                    });

                    tx.update(encomendaRef, {
                        reenvioPendente: FieldValue.delete()
                    });
                }
            });

            return res.status(502).json({
                sucesso: false,
                envioEmail: "falha",
                erro: "E-mail não aceito. Nenhum código foi substituído."
            });
        }

        try {
            await db.runTransaction(async tx => {
            const [atual, codigos] = await Promise.all([
                tx.get(encomendaRef),
                tx.get(consultaCodigos)
            ]);

            if (
                !atual.exists ||
                atual.data().reenvioPendente?.id !== identificador ||
                atual.data().reenvioPendente?.codigoHash !== codigoHash ||
                typeof atual.data().reenvioPendente?.expiraEm?.toMillis !== "function" ||
                atual.data().reenvioPendente.expiraEm.toMillis() <= Date.now() ||
                atual.data().documentoHash !== encomenda.documentoHash ||
                atual.data().emailContato !== encomenda.emailContato ||
                codigos.size > 100
            ) {
                throw new Error("REENVIO_BLOQUEADO");
            }

            const novoCodigoAtual = await tx.get(novoCodigoRef);

            if (
                !novoCodigoAtual.exists ||
                novoCodigoAtual.data().estado !== "pendente"
            ) {
                throw new Error("REENVIO_BLOQUEADO");
            }

            for (const doc of codigos.docs) {
                if (
                    doc.id !== novoCodigoRef.id &&
                    doc.data().utilizado === false
                ) {
                    tx.update(doc.ref, {
                        utilizado: true,
                        estado: "cancelado",
                        invalidadoEm: FieldValue.serverTimestamp()
                    });
                }
            }

            tx.update(novoCodigoRef, {
                estado: "ativo",
                ativadoEm: FieldValue.serverTimestamp()
            });

            tx.update(encomendaRef, {
                ultimoReenvioVinculacao: FieldValue.serverTimestamp(),
                reenvioPendente: FieldValue.delete()
            });
            });
        } catch (erroAtivacao) {
            console.error(
                "E-mail aceito, mas ativação pendente:",
                erroAtivacao.code || "erro"
            );

            return res.status(503).json({
                sucesso: false,
                envioEmail: "aceito_pelo_resend",
                ativacao: "pendente_verificacao",
                erro: "E-mail aceito, mas o código não foi ativado. Solicite verificação administrativa antes de tentar novamente."
            });
        }

        return res.status(200).json({
            sucesso: true,
            codigo: codigoRastreamento,
            codigoAnteriorInvalidado: true,
            envioEmail: "aceito_pelo_resend"
        });

    } catch (erro) {
        if (erro.message === "REENVIO_FREQUENTE") {
            return res.status(429).json({
                erro: "Aguarde antes de solicitar outro código."
            });
        }

        if (erro.message === "REENVIO_BLOQUEADO") {
            return res.status(409).json({
                erro: "Não foi possível renovar o código desta encomenda."
            });
        }

        console.error("Falha no reenvio:", erro.code || "erro");

        return res.status(500).json({
            erro: "Não foi possível processar o reenvio."
        });
    }
}
