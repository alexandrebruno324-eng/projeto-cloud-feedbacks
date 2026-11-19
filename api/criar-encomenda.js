import { Resend } from "resend";
import { config as carregarEnv } from "dotenv";

if (process.env.NODE_ENV !== "production") {
    carregarEnv({ path: ".env.local", override: false });
}

import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { createHmac, createHash, randomBytes } from "node:crypto";

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

function documentoValido(valor) {
    if (![11, 14].includes(valor.length)) return false;
    if (/^(\d)\1+$/.test(valor)) return false;

    if (valor.length === 11) {
        const calcular = (tamanho) => {
            let soma = 0;
            for (let i = 0; i < tamanho; i++) {
                soma += Number(valor[i]) * (tamanho + 1 - i);
            }
            const resto = (soma * 10) % 11;
            return resto === 10 ? 0 : resto;
        };

        return calcular(9) === Number(valor[9]) &&
               calcular(10) === Number(valor[10]);
    }

    const calcular = (tamanho) => {
        const pesos = tamanho === 12
            ? [5,4,3,2,9,8,7,6,5,4,3,2]
            : [6,5,4,3,2,9,8,7,6,5,4,3,2];

        const soma = pesos.reduce(
            (total, peso, i) => total + Number(valor[i]) * peso, 0
        );

        const resto = soma % 11;
        return resto < 2 ? 0 : 11 - resto;
    };

    return calcular(12) === Number(valor[12]) &&
           calcular(13) === Number(valor[13]);
}

export default async function handler(req, res) {
    res.setHeader("Cache-Control", "no-store");

    if (req.method !== "POST") {
        res.setHeader("Allow", "POST");
        return res.status(405).json({ erro: "Método não permitido." });
    }

    const segredo = process.env.DOCUMENT_HMAC_SECRET;

    if (!segredo || !/^[a-f0-9]{64}$/i.test(segredo)) {
        console.error("DOCUMENT_HMAC_SECRET não configurado.");
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

        const dados = req.body || {};

        const documento = typeof dados.cpfCnpj === "string"
            ? dados.cpfCnpj.replace(/\D/g, "") : "";

        const telefone = typeof dados.telefone === "string"
            ? dados.telefone.replace(/\D/g, "") : "";

        const email = typeof dados.emailCliente === "string"
            ? dados.emailCliente.trim().toLowerCase() : "";

        const origem = dados.origem;
        const destino = dados.destino;
        const previsaoEntrega = dados.previsaoEntrega;

        if (!documentoValido(documento)) {
            return res.status(400).json({
                erro: "CPF ou CNPJ inválido."
            });
        }

        if (!/^[1-9][0-9]{9,10}$/.test(telefone)) {
            return res.status(400).json({
                erro: "Informe um telefone válido com DDD."
            });
        }

        if (
            email.length > 254 ||
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
        ) {
            return res.status(400).json({
                erro: "E-mail inválido."
            });
        }

        if (
            typeof origem !== "string" ||
            typeof destino !== "string" ||
            typeof previsaoEntrega !== "string" ||
            !origem.trim() || origem.length > 120 ||
            !destino.trim() || destino.length > 120 ||
            !previsaoEntrega.trim() || previsaoEntrega.length > 40
        ) {
            return res.status(400).json({
                erro: "Dados da entrega inválidos."
            });
        }

        const documentoHash = createHmac("sha256", segredo)
            .update(documento)
            .digest("hex");

        const ano = new Date().getUTCFullYear();

        const sequenciaRef = db.collection("sequencias")
            .doc(`encomendas-${ano}`);

        const encomendaRef = db.collection("encomendas").doc();

        const codigoVinculacao = randomBytes(32).toString("hex");

        const codigoHash = createHash("sha256")
            .update(codigoVinculacao)
            .digest("hex");

        const codigoRef = db.collection("codigosVinculacao")
            .doc(codigoHash);

        const expiraEm = new Date(
            Date.now() + 7 * 24 * 60 * 60 * 1000
        );

        const codigo = await db.runTransaction(async (tx) => {
            const sequencia = await tx.get(sequenciaRef);

            const ultimo = sequencia.exists
                ? Number(sequencia.data().ultimo)
                : 100000;

            if (!Number.isSafeInteger(ultimo) ||
                ultimo < 100000 || ultimo >= Number.MAX_SAFE_INTEGER) {
                throw new Error("Sequência inválida.");
            }

            const proximo = ultimo + 1;

            const novoCodigo =
                `BRN-${ano}-${String(proximo).padStart(6, "0")}`;

            tx.set(sequenciaRef, {
                ultimo: proximo,
                atualizadoEm: FieldValue.serverTimestamp()
            });

            tx.create(encomendaRef, {
                codigo: novoCodigo,
                documentoHash,
                documentoFinal: documento.slice(-4),
                tipoDocumento: documento.length === 11 ? "CPF" : "CNPJ",
                emailContato: email,
                telefoneContato: telefone,
                clienteUid: null,
                status: "Preparando envio",
                origem: origem.trim(),
                destino: destino.trim(),
                previsaoEntrega: previsaoEntrega.trim(),
                entregue: false,
                avaliada: false,
                criadoPor: administrador.uid,
                criadoEm: FieldValue.serverTimestamp()
            });

            tx.create(codigoRef, {
                documentoHash,
                emailPermitido: email,
                encomendaId: encomendaRef.id,
                utilizado: false,
                expiraEm: expiraEm,
                criadoEm: FieldValue.serverTimestamp()
            });

            return novoCodigo;
        });

        let estadoEmailVinculacao = "nao_configurado";

        const chaveResend = process.env.RESEND_API_KEY;
        const remetente = process.env.RESEND_FROM_EMAIL?.trim();

        if (chaveResend && remetente) {
            try {
                const resend = new Resend(chaveResend);

                const resultado = await resend.emails.send({
                    from: remetente,
                    to: email,
                    subject: "BRN Transportes - Vincule sua encomenda",
                    text: [
                        "Olá!",
                        "",
                        "Uma encomenda foi cadastrada para você na BRN Transportes.",
                        "",
                        `Código de rastreamento: ${codigo}`,
                        `Código secreto de vinculação: ${codigoVinculacao}`,
                        "",
                        "Acesse a Área do Cliente da BRN Transportes.",
                        "Entre com o e-mail informado no cadastro da entrega.",
                        "Informe seu CPF/CNPJ e o código secreto para vincular a encomenda.",
                        "",
                        "O código secreto expira em 7 dias e só pode ser utilizado uma vez.",
                        "Não compartilhe esse código com outras pessoas.",
                        "",
                        "Se você não reconhece esta encomenda, ignore esta mensagem.",
                        "",
                        "BRN Transportes"
                    ].join("\n")
                });

                if (resultado.error || !resultado.data?.id) {
                    estadoEmailVinculacao = "falha";
                    console.error(
                        "Falha ao enviar código de vinculação:",
                        resultado.error?.name || "resposta_invalida"
                    );
                } else {
                    estadoEmailVinculacao = "aceito_pelo_resend";
                }
            } catch (erroEmail) {
                estadoEmailVinculacao = "falha";
                console.error(
                    "Falha ao enviar código de vinculação:",
                    erroEmail.name || "erro"
                );
            }
        }

        if (estadoEmailVinculacao !== "aceito_pelo_resend") {
            try {
                await db.runTransaction(async tx => {
                    const codigoDoc = await tx.get(codigoRef);

                    if (
                        !codigoDoc.exists ||
                        codigoDoc.data().encomendaId !== encomendaRef.id ||
                        codigoDoc.data().documentoHash !== documentoHash
                    ) {
                        throw new Error("CODIGO_INCONSISTENTE");
                    }

                    if (codigoDoc.data().utilizado === false) {
                        tx.update(codigoRef, {
                            utilizado: true,
                            estado: "cancelado",
                            invalidadoEm: FieldValue.serverTimestamp(),
                            motivoInvalidacao: "email_nao_enviado"
                        });
                    }
                });
            } catch (erroRevogacao) {
                console.error(
                    "Falha ao invalidar código não enviado:",
                    erroRevogacao.code || "erro"
                );

                estadoEmailVinculacao = "falha_revogacao";
            }
        }

        return res.status(201).json({
            sucesso: true,
            id: encomendaRef.id,
            codigo,
            envioEmail: estadoEmailVinculacao,
            mensagem: "Encomenda cadastrada com sucesso."
        });

    } catch (erro) {
        console.error("Erro no cadastro:", erro);

        return res.status(500).json({
            erro: "Não foi possível cadastrar a encomenda."
        });
    }
}
