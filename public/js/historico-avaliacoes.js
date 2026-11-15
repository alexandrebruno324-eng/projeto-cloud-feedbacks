import { auth } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";

const lista = document.getElementById("lista-avaliacoes");

function criarTexto(tag, texto) {
    const elemento = document.createElement(tag);
    elemento.textContent = texto;
    return elemento;
}

async function carregarHistorico(usuario) {
    lista.replaceChildren();

    if (!usuario || !usuario.emailVerified) {
        lista.appendChild(criarTexto("p", "Entre na sua conta para consultar as avaliações."));
        return;
    }

    lista.appendChild(criarTexto("p", "Carregando avaliações..."));

    try {
        const token = await usuario.getIdToken();

        const cabecalhos = {
            Authorization: `Bearer ${token}`
        };

        const [respostaAvaliacoes, respostaEncomendas] = await Promise.all([
            fetch("/api/minhas-avaliacoes", { headers: cabecalhos }),
            fetch("/api/encomendas", { headers: cabecalhos })
        ]);

        const dados = await respostaAvaliacoes.json();

        if (!respostaAvaliacoes.ok) {
            throw new Error(dados.erro || "Erro ao consultar avaliações.");
        }

        const mapa = new Map();

        if (respostaEncomendas.ok) {
            const resultado = await respostaEncomendas.json();

            for (const encomenda of resultado.encomendas || []) {
                mapa.set(encomenda.id, encomenda.codigo);
            }
        }

        lista.replaceChildren();

        if (!dados.avaliacoes?.length) {
            lista.appendChild(criarTexto("p", "Você ainda não possui avaliações de entregas."));
            return;
        }

        for (const avaliacao of dados.avaliacoes) {
            const cartao = document.createElement("article");
            cartao.style.cssText = "padding:20px;margin-bottom:16px;border:1px solid #8885;border-radius:12px;";

            const codigo = mapa.get(avaliacao.encomendaId) || avaliacao.encomendaId;

            cartao.appendChild(criarTexto("h3", `Encomenda ${codigo}`));
            cartao.appendChild(criarTexto("p", avaliacao.texto));
            cartao.appendChild(criarTexto("p", `Sentimento: ${avaliacao.sentimento}`));
            cartao.appendChild(criarTexto("p", `Categoria: ${avaliacao.categoria}`));

            if (avaliacao.criadoEm) {
                cartao.appendChild(criarTexto(
                    "small",
                    `Avaliada em ${new Date(avaliacao.criadoEm).toLocaleString("pt-BR")}`
                ));
            }

            lista.appendChild(cartao);
        }
    } catch (erro) {
        lista.replaceChildren();
        lista.appendChild(criarTexto("p", erro.message));
    }
}

onAuthStateChanged(auth, carregarHistorico);
