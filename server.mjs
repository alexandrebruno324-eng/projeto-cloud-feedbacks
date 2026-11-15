
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = dirname(fileURLToPath(import.meta.url));
const pastaPublica = resolve(raiz, "public");
const porta = Number(process.env.PORT || 3000);

const tipos = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2"
};

function responderErro(res, codigo, mensagem) {
    if (res.headersSent) {
        res.end();
        return;
    }

    res.writeHead(codigo, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
    });

    res.end(JSON.stringify({ erro: mensagem }));
}

function prepararRespostaApi(res) {
    res.status = (codigo) => {
        res.statusCode = codigo;
        return res;
    };

    res.json = (dados) => {
        if (res.writableEnded) {
            return res;
        }

        res.setHeader(
            "Content-Type",
            "application/json; charset=utf-8"
        );

        res.end(JSON.stringify(dados));
        return res;
    };
}

async function lerCorpo(req) {
    const partes = [];
    let tamanho = 0;

    for await (const parte of req) {
        tamanho += parte.length;

        if (tamanho > 1024 * 1024) {
            const erro = new Error("Corpo da requisição muito grande.");
            erro.statusCode = 413;
            throw erro;
        }

        partes.push(parte);
    }

    if (partes.length === 0) {
        return {};
    }

    const conteudo = Buffer.concat(partes).toString("utf8");

    try {
        return JSON.parse(conteudo);
    } catch {
        const erro = new Error("JSON inválido.");
        erro.statusCode = 400;
        throw erro;
    }
}

async function executarApi(req, res, caminho) {
    prepararRespostaApi(res);

    const modulos = {
        "/api/feedback": "./api/feedback.js",
        "/api/encomendas": "./api/encomendas.js",
        "/api/minhas-avaliacoes": "./api/minhas-avaliacoes.js"
    };

    const modulo = modulos[caminho];

    if (!modulo) {
        responderErro(res, 404, "API não encontrada.");
        return;
    }

    try {
        if (req.method === "POST") {
            req.body = await lerCorpo(req);
        }

        const arquivo = await import(new URL(modulo, import.meta.url));

        await arquivo.default(req, res);

        if (!res.writableEnded) {
            responderErro(res, 500, "Resposta incompleta da API.");
        }
    } catch (erro) {
        console.error("Erro na execução da API:", erro.message);

        responderErro(
            res,
            erro.statusCode || 500,
            erro.statusCode
                ? erro.message
                : "Erro interno do servidor."
        );
    }
}

async function servirArquivo(req, res, caminho) {
    if (req.method !== "GET" && req.method !== "HEAD") {
        res.setHeader("Allow", "GET, HEAD");
        responderErro(res, 405, "Método não permitido.");
        return;
    }

    let caminhoDecodificado;

    try {
        caminhoDecodificado = decodeURIComponent(caminho);
    } catch {
        responderErro(res, 400, "Caminho inválido.");
        return;
    }

    if (caminhoDecodificado.includes("\0")) {
        responderErro(res, 400, "Caminho inválido.");
        return;
    }

    const partes = caminhoDecodificado.split("/");

    if (partes.some((parte) => parte.startsWith("."))) {
        responderErro(res, 403, "Acesso negado.");
        return;
    }

    const nomeArquivo = caminhoDecodificado === "/"
        ? "/home.html"
        : caminhoDecodificado;

    const destino = resolve(
        pastaPublica,
        "." + nomeArquivo
    );

    const caminhoRelativo = relative(pastaPublica, destino);

    if (
        caminhoRelativo === ".." ||
        caminhoRelativo.startsWith(".." + sep) ||
        caminhoRelativo.startsWith(sep)
    ) {
        responderErro(res, 403, "Acesso negado.");
        return;
    }

    try {
        const informacoes = await stat(destino);

        if (!informacoes.isFile()) {
            responderErro(res, 404, "Arquivo não encontrado.");
            return;
        }

        const conteudo = await readFile(destino);
        const extensao = extname(destino).toLowerCase();

        res.writeHead(200, {
            "Content-Type": tipos[extensao] ||
                "application/octet-stream",
            "X-Content-Type-Options": "nosniff"
        });

        res.end(req.method === "HEAD" ? undefined : conteudo);
    } catch {
        responderErro(res, 404, "Arquivo não encontrado.");
    }
}

const servidor = http.createServer(async (req, res) => {
    try {
        const url = new URL(
            req.url,
            `http://${req.headers.host || "localhost"}`
        );

        const caminho = url.pathname;

        if (caminho === "/health") {
            res.writeHead(200, {
                "Content-Type": "application/json; charset=utf-8",
                "Cache-Control": "no-store"
            });

            res.end(JSON.stringify({
                status: "ok",
                aplicacao: "BRN Transportes"
            }));

            return;
        }

        if (caminho.startsWith("/api/")) {
            await executarApi(req, res, caminho);
            return;
        }

        await servirArquivo(req, res, caminho);
    } catch (erro) {
        console.error("Erro HTTP:", erro.message);

        responderErro(res, 500, "Erro interno do servidor.");
    }
});

servidor.listen(porta, "0.0.0.0", () => {
    console.log(`BRN Transportes iniciada na porta ${porta}`);
});
