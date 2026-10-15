#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation / Univertix. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '../..');

const esbuildModule = await import(path.join(root, 'build/node_modules/esbuild/lib/main.js'));
const esbuild = esbuildModule.default || esbuildModule;

const OUT_DIR = path.join(root, 'dist-proctor');

console.log('📦 Iniciando empacotamento do Univertix Exam Proctor Portátil...');

// 1. Ensure output directory
if (fs.existsSync(OUT_DIR)) {
	fs.rmSync(OUT_DIR, { recursive: true, force: true });
}
fs.mkdirSync(OUT_DIR, { recursive: true });

// 2. Read public/index.html to inline into bundle
const htmlPath = path.join(__dirname, 'public', 'index.html');
const htmlContent = fs.readFileSync(htmlPath, 'utf8');

// 3. Create a bundle entry file with inlined HTML
const entryPath = path.join(OUT_DIR, 'bundle-entry.mjs');
let serverSource = fs.readFileSync(path.join(__dirname, 'server.mjs'), 'utf8');

// Replace static file reading with inlined HTML fallback
serverSource = serverSource.replace(/^#!.*\r?\n/, '');
serverSource = serverSource.replace(
	`const __filename = fileURLToPath(import.meta.url);`,
	`// CJS globals __filename and __dirname are available`
);
serverSource = serverSource.replace(
	`const __dirname = path.dirname(__filename);`,
	``
);
serverSource = serverSource.replace(
	`import { fileURLToPath } from 'url';`,
	``
);
serverSource = serverSource.replace(
	`res.writeHead(500);\n\t\t\t\tres.end('Erro ao carregar recurso');`,
	`res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });\n\t\t\t\tres.end(INLINED_HTML);`
);

serverSource = `// Inlined HTML Dashboard for 100% self-contained standalone execution\nconst INLINED_HTML = ${JSON.stringify(htmlContent)};\n\n` + serverSource;
fs.writeFileSync(entryPath, serverSource, 'utf8');

// 4. Bundle with esbuild
const bundledFile = path.join(OUT_DIR, 'server-bundle.cjs');
console.log('⚡ Gerando bundle CommonJS com esbuild...');

esbuild.buildSync({
	entryPoints: [entryPath],
	bundle: true,
	platform: 'node',
	target: 'node20',
	format: 'cjs',
	outfile: bundledFile,
	external: ['ws'], // ws has native bindings or can be required
});

// Also copy ws module to OUT_DIR/node_modules for standalone portability
const outNodeModules = path.join(OUT_DIR, 'node_modules');
fs.mkdirSync(outNodeModules, { recursive: true });
const wsSource = path.join(root, 'node_modules', 'ws');
if (fs.existsSync(wsSource)) {
	fs.cpSync(wsSource, path.join(outNodeModules, 'ws'), { recursive: true });
}

// 5. Create launcher scripts
const startSh = `#!/usr/bin/env bash
DIR="$( cd "$( dirname "\${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

if [ -f "$DIR/bin/node" ]; then
    "$DIR/bin/node" server-bundle.cjs "$@"
elif command -v node >/dev/null 2>&1; then
    node server-bundle.cjs "$@"
else
    echo "=================================================================="
    echo "  Erro: Node.js não foi encontrado nesta máquina."
    echo "  Por favor, instale o Node.js ou coloque o binário em dist-proctor/bin/node."
    echo "=================================================================="
    exit 1
fi
`;
fs.writeFileSync(path.join(OUT_DIR, 'start-proctor.sh'), startSh, { mode: 0o755 });

const startBat = `@echo off
setlocal
cd /d "%~dp0"

if exist "%~dp0bin\\node.exe" (
    "%~dp0bin\\node.exe" server-bundle.cjs %*
    goto end
)

where node >nul 2>nul
if %ERRORLEVEL% equ 0 (
    node server-bundle.cjs %*
    goto end
)

echo ==================================================================
echo   Erro: Node.js nao foi encontrado no sistema.
echo   Por favor, instale o Node.js ou coloque node.exe na pasta bin\\
echo ==================================================================
pause

:end
`;
fs.writeFileSync(path.join(OUT_DIR, 'start-proctor.bat'), startBat);

// 6. Create README for teacher
const readme = `==================================================================
  🛡️  UNIVERTIX EXAM SHIELD — PAINEL DO PROFESSOR (PORTÁTIL)
==================================================================

COMO EXECUTAR NO SEU COMPUTADOR OU PEN DRIVE:

No Windows:
  -> Dê 2 cliques no arquivo 'start-proctor.bat'.

No Linux:
  -> Execute no terminal: ./start-proctor.sh

O QUE ACONTECE:
  1. Uma janela abrirá mostrando os endereços IP da sua máquina.
  2. Seu navegador abrirá automaticamente no Painel em http://localhost:3001.
  3. Diga aos alunos para conectarem no IP exibido (ex: ws://192.168.1.100:3001).
  4. Todos os logs da prova são gravados automaticamente na pasta 'audit-logs/'.
==================================================================
`;
fs.writeFileSync(path.join(OUT_DIR, 'LEIA-ME.txt'), readme, 'utf8');

// 7. Copy public folder as well
fs.cpSync(path.join(__dirname, 'public'), path.join(OUT_DIR, 'public'), { recursive: true });

// 8. Clean up temp entry
if (fs.existsSync(entryPath)) {
	fs.unlinkSync(entryPath);
}

// 9. Create zip package if zip is available
const zipOut = path.join(root, 'dist-proctor.zip');
try {
	execSync(`cd "${root}" && zip -r -q "${zipOut}" "dist-proctor"`, { stdio: 'ignore' });
	console.log(`📦 Arquivo compactado gerado: ${zipOut}`);
} catch { }

console.log(`
🎉 SUCESSO! Pasta portátil do Professor gerada em:
📁 ${OUT_DIR}
   ├── start-proctor.bat           (Para o Professor rodar no Windows com 2 cliques)
   ├── start-proctor.sh            (Para o Professor rodar no Linux)
   ├── server-bundle.cjs           (Bundle do servidor auto-contido com Painel)
   ├── node_modules/ws             (Dependência WebSocket embutida)
   └── LEIA-ME.txt                 (Instruções rápidas para o dia da prova)
`);

