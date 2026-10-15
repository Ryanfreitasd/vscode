# 🛡️ Univertix Exam Shield — Manual Completo do Sistema de Auditoria e Prova Prática Portátil

Este documento descreve a arquitetura, o funcionamento técnico e o passo a passo operacional para a realização de provas práticas de programação utilizando a versão customizada do **Code - OSS (VS Code da Univertix)** com o módulo **Univertix Exam Shield** e o **Painel do Professor Portátil**.

---

## 📋 Sumário
1. [Visão Geral e Objetivos](#1-visão-geral-e-objetivos)
2. [Mecanismos de Detecção Anti-Cheat (Tempo Real)](#2-mecanismos-de-detecção-anti-cheat-tempo-real)
3. [Arquitetura Portátil (Sem Instalação)](#3-arquitetura-portátil-sem-instalação)
4. [Painel do Professor (Executável Portátil)](#4-painel-do-professor-executável-portátil)
5. [Passo a Passo para o Dia da Prova](#5-passo-a-passo-para-o-dia-da-prova)
6. [Comandos de Compilação e Empacotamento](#6-comandos-de-compilação-e-empacotamento)
7. [Tabela de Configurações (`settings.json`)](#7-tabela-de-configurações-settingsjson)
8. [Auditoria e Relatórios Oficiais de Prova](#8-auditoria-e-relatórios-oficiais-de-prova)

---

## 1. Visão Geral e Objetivos

O **Univertix Exam Shield** foi projetado para ambientes acadêmicos onde os estudantes realizam avaliações práticas de programação em laboratórios de informática ou em computadores próprios.

### O Problema Resolvido:
* Consulta e cópia de códigos prontos gerados por Inteligência Artificial (ChatGPT, Claude, Copilot, etc.).
* Uso de pen drives com soluções prévias ou códigos de colegas.
* Navegação em navegadores ou documentos externos durante a avaliação.
* Ausência de evidências técnicas formais para comprovar infrações acadêmicas.

### A Solução:
Um ambiente controlado no próprio executável do VS Code que:
1. Funciona de forma **100% portátil** (sem instalar nada na máquina do laboratório).
2. Intercepta e classifica toda ação realizada no editor.
3. Transmite eventos e alertas em **tempo real via WebSocket** para o painel do professor.
4. Gera relatórios de auditoria gravados em disco para atas e processos disciplinares.

---

## 2. Mecanismos de Detecção Anti-Cheat (Tempo Real)

```text
┌─────────────────────────────────────────────────────────────┐
│                    VS CODE DO ALUNO                         │
│                                                             │
│  [Ctrl+C legítimo no editor] ──► Cache em Memória           │
│                                                             │
│  [Ctrl+V de fora] ─────────────► 🚨 ALERTA: Origem Externa  │
│  [Abertura de /media/usb] ─────► 🚨 ALERTA: Pen Drive       │
│  [Alt + Tab / Perda de Foco] ──► ⚠️ AVISO: Fora da Janela   │
│  [Inserção em bloco súbita] ───► 🚨 ALERTA: Burst Typing    │
└──────────────────────────────┬──────────────────────────────┘
                               │ WebSocket (Tempo Real)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│               PAINEL DO PROFESSOR (PORTÁTIL)                │
│                                                             │
│  • Visualização em grade de todos os alunos online          │
│  • Feed de alertas instantâneos com bip sonoro              │
│  • Inspeção do código exato colado pelo aluno               │
│  • Linha do tempo completa (prontuário de cada estudante)   │
│  • Exportação oficial em CSV e JSON                         │
└─────────────────────────────────────────────────────────────┘
```

### 2.1 Rastreamento Inteligente de Área de Transferência (Interno vs. Externo)
* **Cópia Interna Legítima:** Quando o aluno copia (`Ctrl+C` ou `Ctrl+X`) um trecho que ele mesmo escreveu dentro do VS Code, o texto é registrado no cache interno da sessão.
* **Colagem Externa (`EXTERNAL_PASTE`):** Quando o aluno cola (`Ctrl+V`) um texto com mais de 20 caracteres que não conste no cache interno, o sistema identifica que o código veio de **fora do VS Code** (ChatGPT, Chrome, Discord, bloco de notas, PDF, etc.).
* **Evidência Registrada:** O sistema captura o timestamp, o arquivo, a linha, a quantidade de caracteres e o **código exato** que foi colado.

### 2.2 Detecção de Pen Drive e Mídias Removíveis (`PEN_DRIVE_DETECTED`)
* O editor monitora abertura e salvamento de arquivos em mídias removíveis:
  * **Linux:** `/media/*`, `/run/media/*`, `/mnt/*`.
  * **Windows:** Unidades removíveis de `D:\` a `Z:\` que não sejam a unidade do workspace.
  * **macOS:** `/Volumes/*` (exceto o disco principal).
* A tentativa de abrir um arquivo direto do pen drive dispara um alerta imediato de infração crítica.

### 2.3 Detecção de Saída de Janela / Alt + Tab (`WINDOW_BLURRED` e `WINDOW_FOCUSED`)
* O sistema identifica no momento exato em que o aluno desfoca ou minimiza a janela do VS Code.
* Ao retornar, o sistema calcula o tempo em segundos que o aluno permaneceu fora.
* Ausências prolongadas (> 10s e > 30s) geram alertas de severidade progressiva no painel.

### 2.4 Inserção Súbita de Código em Bloco (`SUSPICIOUS_TYPING_BURST`)
* Monitora alterações volumosas de texto que não tenham sido feitas por digitação manual nem por operações de Desfazer/Refazer (`Undo`/`Redo`), capturando injeções automáticas ou arrastar e soltar de arquivos externos.

---

## 3. Arquitetura Portátil (Sem Instalação)

Tanto o aplicativo do aluno quanto o do professor foram construídos para serem executados de forma **portátil** (a partir de pen drives ou pastas compartilhadas em rede), funcionando em **Windows e Linux**.

### Modo Portátil Oficial do VS Code
O VS Code entra nativamente em modo portátil quando existe uma pasta chamada `data/` na raiz do diretório do executável:

```text
Univertix-VSCode-Portatil/
├── code-oss (ou Code - OSS.exe)
├── bin/
├── data/                               <-- ATIVA O MODO PORTÁTIL
│   ├── user-data/
│   │   └── User/
│   │       └── settings.json           <-- Configurações pré-definidas da prova
│   └── extensions/                     <-- Extensões offline embutidas
└── INSTRUCOES-PROVA.txt
```

#### Vantagens do Modo Portátil:
* **Isolamento Total:** Não grava nem lê nada de `%APPDATA%`, `%USERPROFILE%` (Windows) ou `~/.config/Code` (Linux).
* **Zero Instalação:** Não exige permissões de Administrador nas máquinas do laboratório.
* **Padronização:** Todos os computadores iniciam com o mesmo tema, extensões (Java, Flutter, etc.) e configurações da prova.

---

## 4. Painel do Professor (Executável Portátil)

O professor dispõe de um pacote leve e auto-contido localizado na pasta `dist-proctor/` (ou `dist-proctor.zip`):

```text
dist-proctor/
├── start-proctor.bat       <-- Inicializador para Windows (2 cliques)
├── start-proctor.sh        <-- Inicializador para Linux
├── server-bundle.cjs       <-- Servidor Node.js com o Painel Web embutido
├── node_modules/ws         <-- Módulo WebSocket offline incluído
├── audit-logs/             <-- Onde ficam salvas todas as gravações da prova
└── LEIA-ME.txt             <-- Instruções rápidas
```

### Funcionalidades do Painel Web:
1. **Descoberta Automática de IP:** Ao iniciar, o terminal verifica as placas de rede do computador (Wi-Fi/Ethernet) e lista os IPs que devem ser informados aos alunos.
2. **Abertura Automática:** O navegador abre automaticamente em `http://localhost:3001`.
3. **Cards de Status dos Alunos:**
   * 🟢 **Em Foco:** Aluno com a janela do VS Code ativa e digitando.
   * 🟡 **Fora do VS Code:** Aluno minimizou a janela (mostra cronômetro de tempo fora).
   * ⚪ **Offline:** Aluno desconectado ou fechou o editor.
4. **Feed em Tempo Real com Filtros:** Filtre por *Todos*, *🚨 Infrações Críticas*, *📋 Colagens*, *💾 Pen Drive* e *🔄 Alt+Tab*.
5. **Inspecionador de Código:** Clique sobre qualquer colagem externa para abrir o modal com o código exato colado, arquivo, linha e contagem de caracteres.
6. **Prontuário Individual do Aluno:** Clique no aluno para visualizar toda a linha do tempo dele desde o início da prova.
7. **Alerta Sonoro:** Notificação audível na mesa do professor a cada infração crítica recebida.
8. **Exportação de Relatório:** Baixe a ata completa da prova em planilha **CSV** ou arquivo estruturado **JSON**.

---

## 5. Passo a Passo para o Dia da Prova

### 👨‍🏫 Passo 1: O Professor inicia o Servidor
1. No computador do professor (ou servidor do laboratório), abra a pasta `dist-proctor/`.
2. Dê 2 cliques em `start-proctor.bat` (Windows) ou execute `./start-proctor.sh` (Linux).
3. O terminal abrirá e exibirá:
   ```text
   ==================================================================
     🛡️  UNIVERTIX EXAM SHIELD — PAINEL DO PROFESSOR (PORTÁTIL)
   ==================================================================
     📍 Painel do Professor: http://localhost:3001
     📡 Endereços IP para os Alunos conectarem:
        -> ws://192.168.1.105:3001 (wlan0)
     📁 Arquivo de Auditoria: dist-proctor/audit-logs/exam-audit-*.jsonl
   ==================================================================
   ```
4. O navegador abrirá automaticamente com o Painel do Professor.
5. Anote o IP exibido (ex: `192.168.1.105:3001`) no quadro para os alunos.

---

### 👨‍💻 Passo 2: Os Alunos abrem o VS Code Portátil
1. Os alunos abrem o executável portátil (`Code - OSS.exe` no Windows ou `./code-oss` no Linux).
2. **Identificação Obrigatória do Aluno:**
   * Logo na primeira abertura, uma janela de diálogo surge no topo do editor:
     > *"Identificação do Aluno para a Prova: Digite seu Nome Completo e Matrícula (Ex: Fulano de Tal - 123456)"*
   * O aluno digita seu nome e confirma com `Enter`. O dado fica gravado na sessão e nas configurações da prova.
3. No canto inferior direito da barra de status, os alunos verão o ícone:
   * **`$(shield) Prova: [Nome do Aluno]`**
   * Ao clicar no ícone, abre-se o menu rápido para:
     - ✏️ *Alterar Identificação do Aluno (Nome/Matrícula)*
     - 🌐 *Alterar IP do Servidor do Professor*
     - 🔍 *Ver Status da Conexão*
4. **Para Conectar ao IP do Professor:**
   * Se o IP do professor for diferente do padrão (`localhost:3001`), o aluno clica no escudo e seleciona *Alterar IP*.
   * Surge o prompt no topo da tela:
     > *"Informe o IP ou URL do servidor do professor (ex: 192.168.1.100:3001)"*
   * O aluno digita o IP anunciado pelo professor e pressiona `Enter`.
   * A conexão com o painel do professor é estabelecida instantaneamente.

---

### 🎯 Passo 3: Durante a Avaliação
* Conforme os alunos trabalham, seus nomes e matrículas aparecem no grid do painel.
* Caso um aluno minimize o VS Code, seu card muda para amarelo: `🟡 Fora (15s)`.
* Se o aluno colar código do ChatGPT ou conectar um pen drive, um alerta vermelho pisca no painel e um som de alerta toca no computador do professor.
* O professor clica no alerta e confere o código antes de tomar qualquer medida pedagógica.

---

## 6. Comandos de Compilação e Empacotamento

Todos os scripts de build foram integrados ao repositório:

### 📦 1. Gerar o Pacote Portátil do Professor
Gera a pasta `dist-proctor/` e o arquivo `dist-proctor.zip` prontos para uso:
```bash
npm run package-proctor
```

### 📦 2. Compilar o VS Code Portátil dos Alunos

> [!IMPORTANT]
> **Atenção sobre a Compilação para Windows:**
> O VS Code possui extensões nativas escritas em C++ (`@vscode/policy-watcher`, `@vscode/spdlog`, `node-pty`, `@vscode/sqlite3`) que dependem de chamadas diretas às APIs do Windows (`Win32`). 
> Se você executar o empacotamento do Windows a partir do **Linux**, os binários C++ serão gerados no formato Linux (ELF), fazendo com que o `Code - OSS.exe` feche imediatamente no Windows com o erro `Bad EXE format` (%1 não é um aplicativo Win32 válido).
> 
> **Portanto, o pacote do Windows DEVE ser compilado em um ambiente Windows** (ou via GitHub Actions).

* **Para Linux (x64) — Pode ser compilado no Linux:**
  ```bash
  npm run build-portable linux
  ```
  *Gera: `../Univertix-VSCode-linux-x64-portable.tar.gz` (438 MB)*

* **Para Windows (x64) — Deve ser compilado em máquina Windows:**
  Em um computador com Windows (com Node.js v20/v22 instalado):
  ```cmd
  git pull
  npm install
  npm run build-portable win32
  ```
  *Gera: `../Univertix-VSCode-win32-x64-portable.zip`*

* **Via GitHub Actions (Automático na Nuvem sem máquina Windows local):**
  O repositório já inclui o workflow [`.github/workflows/build-portable-windows.yml`](.github/workflows/build-portable-windows.yml). Basta rodar a Action no GitHub para baixar o arquivo `.zip` para Windows 100% funcional.

---

## 7. Tabela de Configurações (`settings.json`)

As configurações podem ser editadas em `data/user-data/User/settings.json` na versão portátil:

| Configuração | Padrão | Descrição |
| :--- | :--- | :--- |
| `exam.audit.enabled` | `true` | Habilita ou desabilita o módulo de auditoria da prova. |
| `exam.audit.serverUrl` | `"ws://localhost:3001"` | URL WebSocket do servidor/painel do professor. |
| `exam.audit.studentName` | `""` | Nome ou matrícula do aluno. Se vazio, usa o usuário do SO (`$USER`/`%USERNAME%`). |
| `exam.audit.pasteThresholdChars` | `20` | Tamanho mínimo em caracteres para avaliar colagens externas. |
| `exam.audit.blurAlertThresholdSeconds` | `10` | Segundos fora do VS Code (Alt+Tab) para disparar alerta. |

---

## 8. Auditoria e Relatórios Oficiais de Prova

Ao final da prova, o professor pode gerar registros permanentes diretamente pelo Painel Web:

1. **Planilha CSV (`/api/export?format=csv`):**
   * Botão **"📊 Exportar CSV"** no topo do painel.
   * Gera uma planilha contendo: Data/Hora, Nome do Aluno, Matrícula/ID, Gravidade, Tipo de Evento, Arquivo, Linha, Qtd de Caracteres e Descrição.
2. **Log Estruturado JSON (`/api/export?format=json`):**
   * Botão **"📄 Exportar JSON"** no topo do painel.
   * Contém a árvore completa de alunos, contadores e snippets integrais de código interceptados.
3. **Arquivo de Log Contínuo no Disco:**
   * Mesmo que o navegador seja fechado ou a máquina reinicie, todos os eventos são salvos linha a linha em tempo real em:
   * `dist-proctor/audit-logs/exam-audit-<timestamp>.jsonl`
