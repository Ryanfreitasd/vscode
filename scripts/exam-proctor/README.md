# 🛡️ Univertix Exam Shield — Sistema de Auditoria de Provas e Anti-Cheat

Este módulo foi desenvolvido para aplicação em provas práticas com os alunos no **Code - OSS (VS Code da Univertix)**, permitindo **auditoria completa e monitoramento em tempo real** de possíveis infrações acadêmicas.

---

## 🎯 O que o Sistema Detecta

1. **📋 Colagens Externas (ChatGPT, Navegador, Pen Drive, PDF, etc.):**
   - O VS Code intercepta e armazena em memória todo texto legitimamente copiado (`Ctrl+C` / `Ctrl+X`) dentro do próprio editor.
   - Qualquer colagem (`Ctrl+V`) cujo conteúdo não nasceu dentro do VS Code é identificada como **ORIGEM EXTERNA**.
   - Trechos significativos (> 20 caracteres) disparam **Alerta Crítico Imediato (Vermelho)** para o professor, contendo o código exato colado, arquivo, linha e tamanho.
   - Inserções em lote súbitas (*burst typing*) também são interceptadas.

2. **💾 Detecção de Pen Drive e Mídias Removíveis:**
   - Detecta abertura ou salvamento de arquivos em caminhos de pen drive (`/media/*`, `/run/media/*`, `/mnt/*`, unidades `D:\` a `Z:\` no Windows e `/Volumes/*` no macOS).
   - Detecta abertura de arquivos externos fora da pasta oficial da prova.

3. **🔄 Saída da Janela (Alt + Tab / Perda de Foco):**
   - Registra o momento exato em que o aluno minimizou ou saiu da janela do VS Code para navegar em outra aba/aplicativo.
   - Calcula os segundos acumulados fora do ambiente da avaliação e alerta o professor.

4. **⚡ Transmissão em Tempo Real (WebSocket):**
   - Conexão bidirecional entre os VS Codes dos alunos e o painel do professor.
   - Tolerante a falhas: caso o servidor caia ou o aluno fique temporariamente offline, os eventos são colocados em fila e enviados assim que a conexão restabelecer.
   - Gravação contínua em arquivo de log persistente (`audit-logs/exam-audit-*.jsonl`).

---

## 🚀 Como Usar no Dia da Prova

### 1. Iniciar o Painel do Professor

No computador do professor (ou em um servidor da rede do laboratório):

```bash
npm run exam-proctor
```

Ou diretamente com Node:

```bash
node scripts/exam-proctor/server.mjs
```

Abra o navegador no endereço:
👉 **`http://localhost:3001`** (ou `http://<IP-DO-PROFESSOR>:3001`)

### 2. No VS Code dos Alunos

Por padrão, o VS Code tenta se conectar em `ws://localhost:3001`.

Se o servidor estiver rodando no computador do professor na rede local (ex: IP `192.168.1.100`), basta configurar no `settings.json` da máquina dos alunos ou na distribuição:

```json
{
  "exam.audit.enabled": true,
  "exam.audit.serverUrl": "ws://192.168.1.100:3001",
  "exam.audit.studentName": "João Silva - Matrícula 202410"
}
```

> **Dica:** Se `"exam.audit.studentName"` não for configurado, o VS Code utiliza automaticamente o nome de usuário do sistema operacional da máquina (`$USER` ou `$USERNAME`).

---

## 🖥️ Recursos do Painel do Professor

- **Grades de Alunos em Tempo Real:** Visualização instantânea de quem está online, ausente (Alt+Tab) ou desconectado.
- **Feed de Infrações:** Filtre por *Infrações Críticas*, *Colagens*, *Pen Drive* ou *Alt+Tab*.
- **Visualizador de Código Colado:** Clique em qualquer infração para inspecionar exatamente o código colado pelo aluno.
- **Prontuário Individual:** Clique em um aluno para abrir a linha do tempo completa de tudo o que ele fez durante a avaliação.
- **Alertas Sonoros:** Notificação sonora instantânea na mesa do professor quando qualquer aluno cometer uma infração crítica.
- **Exportação de Relatório:**
  - Exportação em planilha **CSV** para atas de prova.
  - Exportação em **JSON** para auditoria completa e arquivo institucional.
