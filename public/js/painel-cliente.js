
import { auth } from "./firebase-config.js";

import {
    onAuthStateChanged,
    signOut,
    reload
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";

const painel = document.getElementById("painel");
const verificandoAcesso = document.getElementById("verificando-acesso");
const emailCliente = document.getElementById("email-cliente");
const botaoSair = document.getElementById("sair-conta");

const totalEncomendas = document.getElementById("total-encomendas");
const emTransporte = document.getElementById("em-transporte");
const entregasConcluidas = document.getElementById("entregas-concluidas");
const saldoPontos = document.getElementById("saldo-pontos");

const formularioRastreamento = document.getElementById("form-rastreamento");
const campoRastreamento = document.getElementById("codigo-rastreamento");
const mensagemRastreamento = document.getElementById("mensagem-rastreamento");
const listaEncomendas = document.getElementById("lista-encomendas");

const detalhesEntrega = document.getElementById("detalhes-entrega");
const detalheCodigo = document.getElementById("detalhe-codigo");
const detalheStatus = document.getElementById("detalhe-status");
const detalheOrigem = document.getElementById("detalhe-origem");
const detalheDestino = document.getElementById("detalhe-destino");
const detalhePrevisao = document.getElementById("detalhe-previsao");
const detalheDataEntrega = document.getElementById("detalhe-data-entrega");
const linhaDoTempo = document.getElementById("linha-do-tempo");

const formularioAvaliacao = document.getElementById("form-avaliacao");
const selecionarEntrega = document.getElementById("entrega-avaliacao");
const botaoEnviarAvaliacao = document.getElementById("enviar-avaliacao");
const mensagemAvaliacao = document.getElementById("mensagem-avaliacao");

let usuarioAtual = null;
let encomendas = [];
let encerrandoSessao = false;

function exibirVerificacao(texto) {
    painel.hidden = true;
    verificandoAcesso.hidden = false;

    const paragrafo = verificandoAcesso.querySelector("p");

    if (paragrafo) {
        paragrafo.textContent = texto;
    }
}

function exibirPainel() {
    verificandoAcesso.hidden = true;
    painel.hidden = false;
}

function irParaLogin() {
    window.location.replace("cliente.html");
}

function formatarStatus(status) {
    const nomes = {
        aguardando_coleta: "Aguardando coleta",
        coletada: "Coletada",
        em_transporte: "Em transporte",
        em_transferencia: "Em transferência",
        saiu_para_entrega: "Saiu para entrega",
        entregue: "Entregue",
        atrasada: "Atrasada",
        cancelada: "Cancelada"
    };

    return nomes[status] ||
        String(status || "Não informado").replaceAll("_", " ");
}

function criarElemento(tag, classe, texto) {
    const elemento = document.createElement(tag);

    if (classe) {
        elemento.className = classe;
    }

    if (texto !== undefined && texto !== null) {
        elemento.textContent = String(texto);
    }

    return elemento;
}

function mostrarEstadoVazio(titulo, descricao) {
    listaEncomendas.replaceChildren();

    const caixa = criarElemento("div", "estado-vazio");
    const tituloElemento = criarElemento("h3", "", titulo);
    const textoElemento = criarElemento("p", "", descricao);

    caixa.append(tituloElemento, textoElemento);
    listaEncomendas.appendChild(caixa);
}

function atualizarResumo() {
    const quantidadeEntregue = encomendas.filter(
        (item) => item.entregue === true
    ).length;

    const quantidadeEmTransporte = encomendas.filter(
        (item) => item.status === "em_transporte"
    ).length;

    totalEncomendas.textContent = String(encomendas.length);
    emTransporte.textContent = String(quantidadeEmTransporte);
    entregasConcluidas.textContent = String(quantidadeEntregue);

    saldoPontos.textContent = "—";
}

function criarInformacao(rotulo, valor) {
    return criarElemento(
        "p",
        "",
        `${rotulo}: ${valor || "Não informado"}`
    );
}

function exibirDetalhes(encomenda) {
    detalheCodigo.textContent = encomenda.codigo || "—";
    detalheStatus.textContent = formatarStatus(encomenda.status);
    detalheOrigem.textContent = encomenda.origem || "—";
    detalheDestino.textContent = encomenda.destino || "—";

    detalhePrevisao.textContent =
        encomenda.previsaoEntrega || "Não informada";

    detalheDataEntrega.textContent =
        encomenda.entregue
            ? "Entrega concluída"
            : "Ainda não entregue";

    linhaDoTempo.replaceChildren();

    const evento = criarElemento("li");
    const titulo = criarElemento(
        "strong",
        "",
        formatarStatus(encomenda.status)
    );

    const descricao = criarElemento(
        "span",
        "",
        "Este é o status atual da encomenda. O histórico detalhado das movimentações será disponibilizado após a integração dos eventos de rastreamento."
    );

    evento.append(titulo, descricao);
    linhaDoTempo.appendChild(evento);

    detalhesEntrega.hidden = false;

    detalhesEntrega.scrollIntoView({
        behavior: "smooth",
        block: "start"
    });
}

function criarCartaoEncomenda(encomenda) {
    const cartao = criarElemento(
        "article",
        "cartao-encomenda"
    );

    const titulo = criarElemento(
        "h3",
        "",
        encomenda.codigo || "Encomenda sem código"
    );

    const status = criarInformacao(
        "Status",
        formatarStatus(encomenda.status)
    );

    const origem = criarInformacao(
        "Origem",
        encomenda.origem
    );

    const destino = criarInformacao(
        "Destino",
        encomenda.destino
    );

    const previsao = criarInformacao(
        "Previsão de entrega",
        encomenda.previsaoEntrega
    );

    const botao = criarElemento(
        "button",
        "",
        "Acompanhar entrega"
    );

    botao.type = "button";

    botao.addEventListener("click", () => {
        exibirDetalhes(encomenda);
    });

    cartao.append(
        titulo,
        status,
        origem,
        destino,
        previsao,
        botao
    );

    return cartao;
}

function renderizarEncomendas(lista = encomendas) {
    listaEncomendas.replaceChildren();

    if (lista.length === 0) {
        mostrarEstadoVazio(
            "Nenhuma encomenda encontrada",
            "Não encontramos encomendas vinculadas à sua conta para esta consulta."
        );

        return;
    }

    lista.forEach((encomenda) => {
        listaEncomendas.appendChild(
            criarCartaoEncomenda(encomenda)
        );
    });
}

function atualizarAvaliacoes() {
    selecionarEntrega.replaceChildren();

    const opcaoInicial = criarElemento(
        "option",
        "",
        "Selecione uma entrega"
    );

    opcaoInicial.value = "";
    selecionarEntrega.appendChild(opcaoInicial);

    const elegiveis = encomendas.filter(
        (item) => item.entregue && !item.avaliada
    );

    elegiveis.forEach((encomenda) => {
        const opcao = criarElemento(
            "option",
            "",
            encomenda.codigo
        );

        opcao.value = encomenda.id;
        selecionarEntrega.appendChild(opcao);
    });

    selecionarEntrega.disabled = elegiveis.length === 0;

    botaoEnviarAvaliacao.disabled = elegiveis.length === 0;

    mensagemAvaliacao.textContent = elegiveis.length > 0
        ? "Selecione uma entrega concluída para enviar sua avaliação."
        : "Nenhuma entrega concluída está disponível para uma nova avaliação.";
}

async function carregarEncomendas(usuario) {
    mostrarEstadoVazio(
        "Carregando suas encomendas",
        "Consultando seus dados com segurança."
    );

    mensagemRastreamento.textContent = "";

    const token = await usuario.getIdToken();

    const resposta = await fetch("/api/encomendas", {
        method: "GET",
        headers: {
            Authorization: `Bearer ${token}`
        },
        cache: "no-store"
    });

    let dados;

    try {
        dados = await resposta.json();
    } catch {
        throw new Error(
            "A API de encomendas não respondeu corretamente. Verifique se você está executando o projeto pela Vercel, e não apenas pelo servidor Python."
        );
    }

    if (!resposta.ok) {
        throw new Error(
            dados.erro || "Falha ao consultar as encomendas."
        );
    }

    if (!Array.isArray(dados.encomendas)) {
        throw new Error(
            "A resposta da API de encomendas é inválida."
        );
    }

    if (auth.currentUser?.uid !== usuario.uid) {
        return;
    }

    encomendas = dados.encomendas;

    atualizarResumo();
    renderizarEncomendas();
    atualizarAvaliacoes();
}

async function verificarUsuario(usuario) {
    if (!usuario) {
        usuarioAtual = null;
        encomendas = [];

        exibirVerificacao("Redirecionando para o login...");
        irParaLogin();
        return;
    }

    exibirVerificacao("Verificando sua conta...");

    await reload(usuario);

    if (!usuario.emailVerified) {
        usuarioAtual = null;

        await signOut(auth);

        exibirVerificacao(
            "Confirme seu e-mail antes de acessar o painel."
        );

        irParaLogin();
        return;
    }

    if (auth.currentUser?.uid !== usuario.uid) {
        return;
    }

    usuarioAtual = usuario;
    emailCliente.textContent = usuario.email || "";

    formularioRastreamento.reset();
    formularioAvaliacao.reset();

    detalhesEntrega.hidden = true;
    saldoPontos.textContent = "—";

    selecionarEntrega.disabled = true;
    botaoEnviarAvaliacao.disabled = true;

    exibirPainel();

    try {
        await carregarEncomendas(usuario);
    } catch (erro) {
        if (auth.currentUser?.uid !== usuario.uid) {
            return;
        }

        encomendas = [];

        totalEncomendas.textContent = "—";
        emTransporte.textContent = "—";
        entregasConcluidas.textContent = "—";

        mostrarEstadoVazio(
            "Não foi possível carregar suas encomendas",
            erro.message
        );

        mensagemRastreamento.textContent =
            "Verifique a conexão com a API e tente atualizar a página.";

        atualizarAvaliacoes();
    }
}

async function sairDaConta() {
    if (encerrandoSessao) {
        return;
    }

    encerrandoSessao = true;
    botaoSair.disabled = true;

    exibirVerificacao("Encerrando sua sessão...");

    try {
        await signOut(auth);
        irParaLogin();
    } catch {
        encerrandoSessao = false;
        botaoSair.disabled = false;

        if (auth.currentUser) {
            exibirPainel();
        }

        window.alert(
            "Não foi possível encerrar sua sessão. Tente novamente."
        );
    }
}

formularioRastreamento.addEventListener(
    "submit",
    (evento) => {
        evento.preventDefault();

        if (!usuarioAtual) {
            irParaLogin();
            return;
        }

        const codigo = campoRastreamento.value.trim();

        if (!codigo) {
            mensagemRastreamento.textContent =
                "Digite o código da encomenda.";

            campoRastreamento.focus();
            return;
        }

        const encomenda = encomendas.find(
            (item) =>
                item.codigo.toLowerCase() === codigo.toLowerCase()
        );

        if (!encomenda) {
            mensagemRastreamento.textContent =
                "Não encontramos esse código entre as encomendas vinculadas à sua conta.";

            detalhesEntrega.hidden = true;
            return;
        }

        mensagemRastreamento.textContent =
            "Encomenda encontrada com sucesso.";

        renderizarEncomendas([encomenda]);
        exibirDetalhes(encomenda);
    }
);

campoRastreamento.addEventListener("input", () => {
    if (!campoRastreamento.value.trim() && usuarioAtual) {
        mensagemRastreamento.textContent = "";
        renderizarEncomendas();
    }
});

formularioAvaliacao.addEventListener(
    "submit",
    async (evento) => {
        evento.preventDefault();

        if (!usuarioAtual || !formularioAvaliacao.reportValidity()) {
            return;
        }

        const encomendaId = selecionarEntrega.value;

        const encomenda = encomendas.find(
            (item) => item.id === encomendaId
        );

        if (!encomenda || !encomenda.entregue || encomenda.avaliada) {
            mensagemAvaliacao.textContent =
                "Esta encomenda não está disponível para avaliação.";
            return;
        }

        const nota = document.getElementById("nota-entrega").value;
        const prazo = document.getElementById("prazo-entrega").selectedOptions[0].textContent.trim();
        const condicao = document.getElementById("condicao-produto").selectedOptions[0].textContent.trim();
        const atendimento = document.getElementById("atendimento").selectedOptions[0].textContent.trim();
        const comentario = document.getElementById("comentario").value.trim();

        const texto = [
            `Nota geral: ${nota}/5`,
            `Prazo: ${prazo}`,
            `Condições do produto: ${condicao}`,
            `Atendimento: ${atendimento}`,
            `Comentário: ${comentario || "Não informado"}`
        ].join("\n");

        botaoEnviarAvaliacao.disabled = true;
        mensagemAvaliacao.textContent = "Analisando sua avaliação...";

        try {
            const token = await usuarioAtual.getIdToken();

            const resposta = await fetch("/api/feedback", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${token}`
                },
                body: JSON.stringify({
                    encomendaId,
                    texto
                })
            });

            const dados = await resposta.json();

            if (!resposta.ok) {
                throw new Error(
                    dados.erro || "Não foi possível enviar a avaliação."
                );
            }

            formularioAvaliacao.reset();

            await carregarEncomendas(usuarioAtual);

            mensagemAvaliacao.textContent =
                `Avaliação enviada! Sentimento: ${dados.sentimento}. Categoria: ${dados.categoria}.`;

        } catch (erro) {
            mensagemAvaliacao.textContent = erro.message;

            botaoEnviarAvaliacao.disabled = false;
        }
    }
);

botaoSair.addEventListener("click", sairDaConta);

exibirVerificacao("Verificando acesso à sua conta...");

onAuthStateChanged(
    auth,
    (usuario) => {
        verificarUsuario(usuario).catch(() => {
            usuarioAtual = null;
            encomendas = [];

            exibirVerificacao(
                "Não foi possível verificar sua conta. Atualize a página e tente novamente."
            );
        });
    },
    () => {
        usuarioAtual = null;

        exibirVerificacao(
            "Erro na autenticação. Verifique sua conexão."
        );
    }
);
