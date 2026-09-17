# projeto-cloud-feedbacks

Projeto Cloud - Análise de Feedbacks com IA

Projeto desenvolvido para a disciplina de Computação em Nuvem.

Objetivo

Desenvolver uma aplicação web capaz de receber feedbacks de usuários e
utilizar Inteligência Artificial para identificar automaticamente:

• Sentimento do feedback: positivo, negativo ou neutro.
• Categoria do feedback.
• Armazenar os resultados em banco de dados na nuvem.
• Enviar alerta por e-mail quando um feedback negativo for
identificado.

Tecnologias Utilizadas

• HTML
• CSS
• JavaScript
• Node.js
• Vercel
• Google Gemini API
• Firebase Cloud Firestore
• Resend API
• Git e GitHub

Funcionamento

Usuário → Frontend → Vercel → Gemini → Firestore → Resultado

Quando o feedback é classificado como negativo:

Feedback negativo → Resend → Alerta por e-mail

Exemplo

Feedback: “A entrega demorou muito.”

Sentimento: negativo
Categoria: Entrega/Logística

O resultado também é armazenado no Cloud Firestore.

Segurança

As credenciais utilizadas pelo sistema não são armazenadas diretamente
no código-fonte.

As chaves do Gemini, Firebase e Resend são configuradas através de
variáveis de ambiente na Vercel.

Estrutura principal

public/index.html — Interface da aplicação e envio dos feedbacks.

api/feedback.js — API responsável por receber o feedback, consultar
o Gemini, salvar no Firestore e acionar o Resend quando necessário.

package.json — Configuração do projeto e dependências.

package-lock.json — Arquivo gerado automaticamente pelo npm para
registrar as versões das dependências.
