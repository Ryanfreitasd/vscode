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
const root = path.resolve(__dirname, '..');
const parentDir = path.dirname(root);

const target = process.argv[2] || 'all'; // 'linux', 'win32', or 'all'

console.log(`
==================================================================
  🎓 UNIVERTIX EXAM SHIELD — BUILD PORTÁTIL (WINDOWS & LINUX)
==================================================================
  Alvo: ${target.toUpperCase()}
==================================================================
`);

function setupPortableData(distDir) {
	const dataDir = path.join(distDir, 'data');
	const userDataDir = path.join(dataDir, 'user-data', 'User');
	const extensionsDir = path.join(dataDir, 'extensions');

	fs.mkdirSync(userDataDir, { recursive: true });
	fs.mkdirSync(extensionsDir, { recursive: true });

	// Pre-configured settings for portable exam mode
	const examSettings = {
		"exam.audit.enabled": true,
		"exam.audit.serverUrl": "ws://localhost:3001",
		"exam.audit.pasteThresholdChars": 20,
		"exam.audit.blurAlertThresholdSeconds": 10,
		"window.title": "Univertix Exam Shield — ${dirty}${activeEditorShort}${separator}${rootName}",
		"telemetry.telemetryLevel": "off",
		"update.mode": "none"
	};

	const settingsPath = path.join(userDataDir, 'settings.json');
	fs.writeFileSync(settingsPath, JSON.stringify(examSettings, null, 2), 'utf8');

	// Instructions file inside portable folder
	const readmePath = path.join(distDir, 'INSTRUCOES-PROVA.txt');
	const readmeContent = `==================================================================
  🛡️  UNIVERTIX EXAM SHIELD — VS CODE PORTÁTIL PARA PROVAS
==================================================================

INSTRUÇÕES PARA O ALUNO:
  1. Esta é uma versão portátil oficial da Univertix para realização de provas.
  2. Não é necessário instalar nada: basta descompactar e executar.
  3. No Linux: execute o arquivo './bin/code-oss' ou './code-oss'.
  4. No Windows: execute 'Code - OSS.exe'.
  5. Na barra de status (canto inferior direito), confirme se o ícone do escudo
     está ativo: '$(shield) Prova Monitorada'.
  6. Para conectar ao IP do professor anunciado no laboratório, clique no escudo
     ou pressione F1 -> 'Univertix: Conectar ao Servidor da Prova'.

AVISO DE INTEGRIDADE ACADÊMICA:
  - Todo o ambiente está sendo auditado em tempo real.
  - Colagens de fontes externas (ChatGPT, Web, Pen Drive) e saídas de tela
    (Alt+Tab) são registradas e transmitidas para o painel do professor.
==================================================================
`;
	fs.writeFileSync(readmePath, readmeContent, 'utf8');
	console.log(`  📁 Pasta 'data/' (Modo Portátil) configurada em: ${dataDir}`);
}

async function buildLinux() {
	console.log('\n🐧 Compilando Code OSS para Linux (x64)...');
	const destinationFolder = path.join(parentDir, 'VSCode-linux-x64');

	console.log('  -> Executando gulp vscode-linux-x64-min...');
	execSync('npm run gulp vscode-linux-x64-min', { cwd: root, stdio: 'inherit' });

	if (fs.existsSync(destinationFolder)) {
		console.log('  -> Configurando modo portátil...');
		setupPortableData(destinationFolder);

		const tarOutput = path.join(parentDir, 'Univertix-VSCode-linux-x64-portable.tar.gz');
		console.log(`  -> Compactando para ${tarOutput}...`);
		execSync(`tar -czf "${tarOutput}" -C "${parentDir}" "VSCode-linux-x64"`, { stdio: 'inherit' });
		console.log(`  ✅ Pacote Linux Portátil pronto: ${tarOutput}`);
	}
}

async function buildWin32() {
	console.log('\n🪟 Compilando Code OSS para Windows (x64)...');
	const destinationFolder = path.join(parentDir, 'VSCode-win32-x64');

	console.log('  -> Executando gulp vscode-win32-x64-min...');
	execSync('npm run gulp vscode-win32-x64-min', { cwd: root, stdio: 'inherit' });

	if (fs.existsSync(destinationFolder)) {
		console.log('  -> Configurando modo portátil...');
		setupPortableData(destinationFolder);

		const zipOutput = path.join(parentDir, 'Univertix-VSCode-win32-x64-portable.zip');
		console.log(`  -> Compactando para ${zipOutput}...`);
		if (process.platform === 'win32') {
			execSync(`powershell Compress-Archive -Path "${destinationFolder}" -DestinationPath "${zipOutput}" -Force`, { stdio: 'inherit' });
		} else {
			execSync(`cd "${parentDir}" && zip -r -q "${zipOutput}" "VSCode-win32-x64"`, { stdio: 'inherit' });
		}
		try {
			fs.copyFileSync(zipOutput, path.join(root, 'Univertix-VSCode-win32-x64-portable.zip'));
		} catch { }
		console.log(`  ✅ Pacote Windows Portátil pronto: ${zipOutput}`);
	}
}

async function main() {
	if (target === 'linux' || target === 'all') {
		await buildLinux();
	}
	if (target === 'win32' || target === 'all') {
		await buildWin32();
	}
}

main().catch(err => {
	console.error('Erro na compilação portátil:', err);
	process.exit(1);
});
