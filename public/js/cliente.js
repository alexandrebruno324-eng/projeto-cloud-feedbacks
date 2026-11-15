
import { auth } from "./firebase-config.js";

import {
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    sendEmailVerification,
    sendPasswordResetEmail,
    signOut,
    reload
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";

const formulario = document.getElementById("form-login");
const campoEmail = document.getElementById("email");
const campoSenha = document.getElementById("senha");
const botaoEntrar = document.getElementById("entrar");
const botaoCriarConta = document.getElementById("criar-conta");
const botaoEsqueciSenha = document.getElementById("esqueci-senha");
const mensagem = document.getElementById("mensagem");
const tituloLogin = document.getElementById("titulo-login");

let modoCadastro = false;
let processando = false;

function mostrarMensagem(texto, tipo = "info") {
    mensagem.textContent = texto;

    const cores = {
        sucesso: "#18c964",
        erro: "#e05c5c",
        info: ""
    };

    mensagem.style.color = cores[tipo] || "";
}

function alterarProcessamento(ativo) {
    processando = ativo;

    botaoEntrar.disabled = ativo;
    botaoCriarConta.disabled = ativo;
    botaoEsqueciSenha.disabled = ativo;

    botaoEntrar.textContent = ativo
        ? "Processando..."
        : modoCadastro
            ? "Criar minha conta"
            : "Entrar na minha conta";
}

function configurarModoCadastro(ativo) {
    modoCadastro = ativo;

    formulario.reset();

    tituloLogin.textContent = ativo
        ? "Crie sua conta"
        : "Acesse sua conta";

    botaoEntrar.textContent = ativo
        ? "Criar minha conta"
        : "Entrar na minha conta";

    botaoCriarConta.textContent = ativo
        ? "Voltar para login"
        : "Criar conta";

    campoSenha.autocomplete = ativo
        ? "new-password"
        : "current-password";

    campoSenha.minLength = ativo ? 6 : 0;

    campoSenha.placeholder = ativo
        ? "Crie uma senha com pelo menos 6 caracteres"
        : "Digite sua senha";

    mostrarMensagem("");
}

function traduzirErro(erro) {
    const mensagens = {
        "auth/invalid-email": "Digite um e-mail válido.",
        "auth/email-already-in-use": "Este e-mail já está cadastrado. Tente entrar ou recuperar sua senha.",
        "auth/weak-password": "Escolha uma senha mais forte.",
        "auth/invalid-password": "A senha informada não é válida.",
        "auth/missing-password": "Digite sua senha.",
        "auth/invalid-credential": "E-mail ou senha incorretos.",
        "auth/wrong-password": "E-mail ou senha incorretos.",
        "auth/user-not-found": "E-mail ou senha incorretos.",
        "auth/too-many-requests": "Muitas tentativas. Tente novamente mais tarde.",
        "auth/network-request-failed": "Falha de conexão. Verifique sua internet.",
        "auth/operation-not-allowed": "Este método de autenticação não está habilitado no Firebase.",
        "auth/unauthorized-domain": "Este domínio não está autorizado no Firebase Authentication."
    };

    return mensagens[erro.code] ||
        "Não foi possível concluir a operação. Tente novamente.";
}

async function criarConta(email, senha) {
    const credencial = await createUserWithEmailAndPassword(
        auth,
        email,
        senha
    );

    try {
        await sendEmailVerification(credencial.user);
    } finally {
        await signOut(auth);
    }

    configurarModoCadastro(false);
    campoEmail.value = email;

    mostrarMensagem(
        "Conta criada! Enviamos um link de confirmação para seu e-mail. Confirme antes de entrar.",
        "sucesso"
    );
}

async function entrarNaConta(email, senha) {
    const credencial = await signInWithEmailAndPassword(
        auth,
        email,
        senha
    );

    await reload(credencial.user);

    if (!credencial.user.emailVerified) {
        await signOut(auth);

        mostrarMensagem(
            "Seu e-mail ainda não foi confirmado. Verifique sua caixa de entrada e a pasta de spam.",
            "erro"
        );

        return;
    }

    mostrarMensagem(
        "Login realizado com sucesso! Redirecionando para seu painel...",
        "sucesso"
    );

    campoSenha.value = "";

    window.location.replace("painel-cliente.html");
}

async function recuperarSenha() {
    if (processando) {
        return;
    }

    const email = campoEmail.value.trim();

    if (!email || !campoEmail.checkValidity()) {
        mostrarMensagem(
            "Digite um e-mail válido no campo acima para recuperar sua senha.",
            "erro"
        );

        campoEmail.focus();
        return;
    }

    alterarProcessamento(true);

    try {
        await sendPasswordResetEmail(auth, email);

        mostrarMensagem(
            "Se houver uma conta cadastrada com esse e-mail, você receberá as instruções para redefinir sua senha.",
            "sucesso"
        );
    } catch (erro) {
        mostrarMensagem(traduzirErro(erro), "erro");
    } finally {
        alterarProcessamento(false);
    }
}

formulario.addEventListener("submit", async (evento) => {
    evento.preventDefault();

    if (processando) {
        return;
    }

    if (!formulario.reportValidity()) {
        return;
    }

    const email = campoEmail.value.trim();
    const senha = campoSenha.value;

    alterarProcessamento(true);
    mostrarMensagem("");

    try {
        if (modoCadastro) {
            await criarConta(email, senha);
        } else {
            await entrarNaConta(email, senha);
        }
    } catch (erro) {
        mostrarMensagem(traduzirErro(erro), "erro");
    } finally {
        alterarProcessamento(false);
    }
});

botaoCriarConta.addEventListener("click", () => {
    if (processando) {
        return;
    }

    configurarModoCadastro(!modoCadastro);
});

botaoEsqueciSenha.addEventListener("click", recuperarSenha);
