
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

const formularioAvaliacao = document.getElementById("form-avaliacao");
const selecionarEntrega = document.getElementById("entrega-avaliacao");
const botaoEnviarAvaliacao = document.getElementById("enviar-avaliacao");
const mensagemAvaliacao = document.getElementById("mensagem-avaliacao");

let usuarioAtual = null;
let encerrandoSessao = false;

function exibirVerificacao(texto) {
    painel.hidden = true;
    verificandoAcesso.hidden = false;

    const mensagem = verificandoAcesso.querySelector("p");

    if (mensagem) {
        mensagem.textContent = texto;
    }
}

function exibirPainel() {
    verificandoAcesso.hidden = true;
    painel.hidden = false;
}

function irParaLogin() {
    window.location.replace("cliente.html");
}

function prepararResumo() {
    totalEncomendas.textContent = "—";
    emTransporte.textContent = "—";
    entregasConcluidas.textContent = "—";
    saldoPontos.textContent = "—";
}

function mostrarEstadoVazio(titulo, descricao) {
    listaEncomendas.replaceChildren();

    const cartao = document.createElement("div");
    cartao.className = "estado-vazio";

    const tituloElemento = document.createElement("h3");
    tituloElemento.textContent = titulo;

    const descricaoElemento = document.createElement("p");
    descricaoElemento.textContent = descricao;

    cartao.append(tituloElemento, descricaoElemento);
    listaEncomendas.appendChild(cartao);
}

function prepararRastreamento() {
    detalhesEntrega.hidden = true;

    mensagemRastreamento.textContent = "";

    mostrarEstadoVazio(
        "Nenhuma encomenda carregada",
        "O rastreamento será disponibilizado após a integração com o banco de dados e a validação de acesso às suas encomendas."
    );
}

function prepararAvaliacoes() {
    selecionarEntrega.replaceChildren();

    const opcao = document.createElement("option");
    opcao.value = "";
    opcao.textContent = "Nenhuma entrega disponível para avaliação";

    selecionarEntrega.appendChild(opcao);
    selecionarEntrega.disabled = true;

    botaoEnviarAvaliacao.disabled = true;

    mensagemAvaliacao.textContent =
        "As avaliações serão liberadas após a integração das entregas concluídas.";
}

function prepararPainel(usuario) {
    usuarioAtual = usuario;

    emailCliente.textContent = usuario.email || "";

    prepararResumo();
    prepararRastreamento();
    prepararAvaliacoes();

    exibirPainel();
}

async function verificarUsuario(usuario) {
    if (!usuario) {
        usuarioAtual = null;
        exibirVerificacao("Redirecionando para a área de login...");
        irParaLogin();
        return;
    }

    exibirVerificacao("Verificando sua conta...");

    await reload(usuario);

    if (!usuario.emailVerified) {
        usuarioAtual = null;

        exibirVerificacao(
            "Confirme seu e-mail antes de acessar o painel."
        );

        await signOut(auth);
        irParaLogin();
        return;
    }

    if (auth.currentUser?.uid !== usuario.uid) {
        return;
    }

    prepararPainel(usuario);
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
    } catch (erro) {
        encerrandoSessao = false;
        botaoSair.disabled = false;

        if (auth.currentUser) {
            exibirPainel();
        } else {
            irParaLogin();
        }

        window.alert(
            "Não foi possível encerrar a sessão. Tente novamente."
        );
    }
}

formularioRastreamento.addEventListener("submit", (evento) => {
    evento.preventDefault();

    if (!usuarioAtual) {
        irParaLogin();
        return;
    }

    const codigo = campoRastreamento.value.trim();

    if (!codigo) {
        mensagemRastreamento.textContent =
            "Informe o código de rastreamento.";
        campoRastreamento.focus();
        return;
    }

    mensagemRastreamento.textContent =
        "A consulta de encomendas ainda está em desenvolvimento. Em breve, os códigos serão validados pelo servidor antes da exibição dos dados.";
});

formularioAvaliacao.addEventListener("submit", (evento) => {
    evento.preventDefault();

    mensagemAvaliacao.textContent =
        "A avaliação será habilitada quando uma entrega concluída e pertencente à sua conta estiver disponível.";
});

botaoSair.addEventListener("click", sairDaConta);

exibirVerificacao("Verificando acesso à sua conta...");

onAuthStateChanged(
    auth,
    (usuario) => {
        verificarUsuario(usuario).catch(() => {
            usuarioAtual = null;

            exibirVerificacao(
                "Não foi possível verificar sua sessão. Atualize a página para tentar novamente."
            );
        });
    },
    () => {
        usuarioAtual = null;

        exibirVerificacao(
            "Erro ao verificar a autenticação. Verifique sua conexão e atualize a página."
        );
    }
);
