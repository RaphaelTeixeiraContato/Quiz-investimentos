# 🎯 Quiz de Investimentos ao Vivo (Estilo Kahoot)

Um aplicativo web moderno, interativo e em tempo real para aplicar um quiz com alunos do ensino médio após a apresentação sobre finanças e investimentos.

---

## 🚀 Como Rodar o Quiz

### 1. Iniciar o Servidor
No terminal, dentro da pasta `quiz-investimentos`, execute:

```bash
npm start
```
*(ou `node server.js`)*

O servidor exibirá no terminal:
- **Apresentador (Telão):** `http://localhost:3000/host`
- **Editor de Perguntas:** `http://localhost:3000/admin`
- **Endereço para os Alunos na mesma rede (Wi-Fi):** `http://<SEU-IP>:3000` (ex: `http://192.168.1.15:3000`)
- **Senha padrão do Apresentador/Editor:** `investir`

---

## 🎮 Como Usar durante a Apresentação

### 1. No Telão (Apresentador)
1. Abra `http://localhost:3000/host` no navegador da sua máquina e projete no telão.
2. Digite a senha (`investir`) para abrir a sala.
3. Um **PIN de 6 dígitos** e um **QR Code** exclusivo serão gerados na tela.
4. Quando os alunos entrarem, os nomes aparecerão em tempo real no telão.
5. Clique em **"Começar quiz ▶"** (ou aperte a tecla **Espaço**) para iniciar!

### 2. No Celular dos Alunos
- **Com QR Code:** Os alunos apenas apontam a câmera do celular para o QR Code no telão.
- **Com Link / IP:** Os alunos abrem o link informado ou acessam `http://<SEU-IP>:3000`, inserem o **PIN** e digitam seu **Apelido/Nome**.
- Não é necessário criar conta nem fazer login!

### 3. Durante as Perguntas
- No telão aparece a pergunta, o tempo restante e o gráfico de respostas.
- No celular dos alunos aparecem as 4 alternativas coloridas com ícones geométricos.
- **Pontuação:** Quanto mais rápido o aluno responder corretamente, mais pontos ele ganha! Sequências de acertos (*streaks*) concedem bônus.
- Ao final, o sistema exibe o ranking parcial e o **Pódio Animado 🏆 com chuva de confetes** para os 3 primeiros colocados.

---

## ✏️ Como Editar e Personalizar Perguntas

Acesse `http://localhost:3000/admin` no navegador:
1. Digite a senha (`investir`).
2. Adicione, edite, altere o tempo ou reordene as perguntas.
3. Marque a alternativa correta em cada uma.
4. Clique em **"💾 Salvar"**.
5. Se desejar, você também pode **Exportar** / **Importar** o arquivo JSON de perguntas para backup.

*Obs: Atualmente o banco já conta com **20 perguntas** cuidadosamente elaboradas sobre Renda Fixa vs Variável, Tesouro Selic, Reserva de Emergência, Liquidez, Juros Compostos, Diversificação e Alertas de Golpes.*

---

## 🌐 Como Disponibilizar por um Link Público na Internet

Se a rede Wi-Fi da escola for restrita, você pode expor o quiz para a internet em poucos segundos:

### Opção A: Túnel Gratuito Instantâneo (Recomendado)
Com o servidor rodando, abra outro terminal e execute:

```bash
npx localtunnel --port 3000
```
*(ou use o `ngrok http 3000` ou `cloudflared`)*

O localtunnel gerará um link público (ex: `https://meu-quiz-financas.loca.lt`). Basta passar esse link para os alunos!

### Opção B: Hospedagem Gratuita na Nuvem (Render / Railway / Glitch)
O projeto já está 100% pronto para hospedar na nuvem:
- Possui a variável de ambiente `PORT` e `ADMIN_PASSWORD`.
- O `package.json` já tem o comando `start`.

---

## 🔐 Alterar a Senha do Apresentador

Por padrão a senha é `investir`. Caso queira alterar, defina a variável de ambiente `ADMIN_PASSWORD` antes de rodar:

**No Windows PowerShell:**
```powershell
$env:ADMIN_PASSWORD="suasenhanova"; npm start
```

**No Linux / Mac / Cloud:**
```bash
ADMIN_PASSWORD="suasenhanova" npm start
```
