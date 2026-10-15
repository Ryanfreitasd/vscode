#!/usr/bin/env node
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation / Univertix. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = parseInt(process.env.PORT || '3001', 10);
const HOST = process.env.HOST || '0.0.0.0';
const LOGS_DIR = process.env.LOGS_DIR || path.join(__dirname, 'audit-logs');

// Ensure audit logs directory exists
if (!fs.existsSync(LOGS_DIR)) {
	fs.mkdirSync(LOGS_DIR, { recursive: true });
}

const sessionTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
const sessionLogFile = path.join(LOGS_DIR, `exam-audit-${sessionTimestamp}.jsonl`);
const logStream = fs.createWriteStream(sessionLogFile, { flags: 'a' });

console.log(`[Exam Proctor] Gravando log de auditoria em: ${sessionLogFile}`);

// In-Memory Data Store
const students = new Map(); // studentId -> StudentRecord
const events = []; // Array of IExamAuditEvent (latest 5000)
const proctorClients = new Set(); // WebSocket clients for teacher dashboard

function writeToAuditLog(event) {
	try {
		logStream.write(JSON.stringify(event) + '\n');
	} catch (err) {
		console.error('[Exam Proctor] Erro ao gravar log de auditoria:', err);
	}
}

function getOrCreateStudent(studentId, name, machineInfo, remoteIp) {
	let student = students.get(studentId);
	if (!student) {
		student = {
			id: studentId,
			name: name || `Aluno ${studentId.substring(0, 6)}`,
			hostname: machineInfo?.hostname || 'desconhecido',
			username: machineInfo?.username || 'desconhecido',
			platform: machineInfo?.platform || 'desconhecido',
			ip: remoteIp || '127.0.0.1',
			status: 'online', // 'online' | 'away' | 'offline'
			connectedAt: new Date().toISOString(),
			lastSeen: Date.now(),
			blurStartedAt: null,
			awaySeconds: 0,
			activeFile: '',
			counts: {
				alerts: 0,
				warnings: 0,
				pastes: 0,
				usb: 0,
				blurs: 0
			}
		};
		students.set(studentId, student);
	} else {
		student.lastSeen = Date.now();
		if (name && student.name !== name) {
			student.name = name;
		}
		if (machineInfo?.hostname) student.hostname = machineInfo.hostname;
		if (machineInfo?.username) student.username = machineInfo.username;
		if (machineInfo?.platform) student.platform = machineInfo.platform;
		if (remoteIp) student.ip = remoteIp;
	}
	return student;
}

function updateStudentWithEvent(student, event) {
	student.lastSeen = Date.now();

	if (event.details?.activeFile) {
		student.activeFile = event.details.activeFile;
	}

	if (event.severity === 'alert') {
		student.counts.alerts++;
	} else if (event.severity === 'warning') {
		student.counts.warnings++;
	}

	switch (event.eventType) {
		case 'STUDENT_CONNECTED':
			student.status = 'online';
			break;
		case 'WINDOW_BLURRED':
			student.status = 'away';
			student.blurStartedAt = Date.now();
			student.counts.blurs++;
			break;
		case 'WINDOW_FOCUSED':
			student.status = 'online';
			student.blurStartedAt = null;
			if (event.details?.durationSeconds) {
				student.awaySeconds += event.details.durationSeconds;
			}
			break;
		case 'EXTERNAL_PASTE':
		case 'SUSPICIOUS_TYPING_BURST':
			student.counts.pastes++;
			break;
		case 'PEN_DRIVE_DETECTED':
			student.counts.usb++;
			break;
		case 'STUDENT_HEARTBEAT':
			if (student.status === 'offline') {
				student.status = 'online';
			}
			break;
	}
}

function broadcastToProctors(payload) {
	const message = JSON.stringify(payload);
	for (const client of proctorClients) {
		if (client.readyState === WebSocket.OPEN) {
			try {
				client.send(message);
			} catch (err) {
				console.error('[Exam Proctor] Erro ao enviar mensagem para proctor:', err);
			}
		}
	}
}

// Check for offline students periodically
setInterval(() => {
	const now = Date.now();
	let changed = false;
	for (const student of students.values()) {
		if (student.status !== 'offline' && (now - student.lastSeen) > 25000) {
			student.status = 'offline';
			changed = true;
			broadcastToProctors({
				type: 'STUDENT_UPDATE',
				student
			});
		}
	}
}, 5000);

// HTTP Server
const server = http.createServer((req, res) => {
	const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
	const pathname = parsedUrl.pathname;

	// CORS Headers
	res.setHeader('Access-Control-Allow-Origin', '*');
	res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
	res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

	if (req.method === 'OPTIONS') {
		res.writeHead(204);
		res.end();
		return;
	}

	// API Endpoints
	if (pathname === '/api/status') {
		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({
			status: 'running',
			activeStudents: Array.from(students.values()).filter(s => s.status !== 'offline').length,
			totalStudents: students.size,
			totalEvents: events.length,
			sessionLogFile,
			uptime: process.uptime()
		}));
		return;
	}

	if (pathname === '/api/students') {
		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify(Array.from(students.values())));
		return;
	}

	if (pathname === '/api/events') {
		const studentId = parsedUrl.searchParams.get('studentId');
		const severity = parsedUrl.searchParams.get('severity');
		const type = parsedUrl.searchParams.get('type');
		const limit = parseInt(parsedUrl.searchParams.get('limit') || '200', 10);

		let filtered = events;
		if (studentId) filtered = filtered.filter(e => e.studentId === studentId);
		if (severity) filtered = filtered.filter(e => e.severity === severity);
		if (type) filtered = filtered.filter(e => e.eventType === type);

		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify(filtered.slice(-limit)));
		return;
	}

	if (pathname === '/api/clear' && req.method === 'POST') {
		students.clear();
		events.length = 0;
		broadcastToProctors({ type: 'SNAPSHOT', students: [], events: [] });
		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.end(JSON.stringify({ success: true, message: 'Dados da sessão limpos com sucesso.' }));
		return;
	}

	if (pathname === '/api/export') {
		const format = parsedUrl.searchParams.get('format') || 'json';
		if (format === 'csv') {
			let csv = 'Data/Hora,Aluno,ID Aluno,Gravidade,Tipo de Evento,Arquivo,Linha,Caracteres,Detalhe\n';
			for (const e of events) {
				const row = [
					`"${e.timestamp}"`,
					`"${e.studentName || ''}"`,
					`"${e.studentId || ''}"`,
					`"${e.severity || ''}"`,
					`"${e.eventType || ''}"`,
					`"${(e.details?.file || '').replace(/"/g, '""')}"`,
					`"${e.details?.line || ''}"`,
					`"${e.details?.charCount || ''}"`,
					`"${(e.details?.reason || '').replace(/"/g, '""')}"`
				];
				csv += row.join(',') + '\n';
			}
			res.writeHead(200, {
				'Content-Type': 'text/csv; charset=utf-8',
				'Content-Disposition': `attachment; filename="auditoria-prova-${sessionTimestamp}.csv"`
			});
			res.end(csv);
			return;
		}

		res.writeHead(200, {
			'Content-Type': 'application/json',
			'Content-Disposition': `attachment; filename="auditoria-prova-${sessionTimestamp}.json"`
		});
		res.end(JSON.stringify({
			exportedAt: new Date().toISOString(),
			sessionLogFile,
			students: Array.from(students.values()),
			events
		}, null, 2));
		return;
	}

	// Serve Static Dashboard
	const publicDir = path.join(__dirname, 'public');
	let filePath = path.join(publicDir, pathname === '/' ? 'index.html' : pathname);

	if (!filePath.startsWith(publicDir)) {
		res.writeHead(403);
		res.end('Acesso Proibido');
		return;
	}

	fs.stat(filePath, (err, stats) => {
		if (err || !stats.isFile()) {
			filePath = path.join(publicDir, 'index.html');
		}

		const ext = path.extname(filePath).toLowerCase();
		const mimeTypes = {
			'.html': 'text/html; charset=utf-8',
			'.css': 'text/css; charset=utf-8',
			'.js': 'text/javascript; charset=utf-8',
			'.json': 'application/json',
			'.svg': 'image/svg+xml',
			'.png': 'image/png'
		};

		const contentType = mimeTypes[ext] || 'application/octet-stream';
		fs.readFile(filePath, (readErr, content) => {
			if (readErr) {
				res.writeHead(500);
				res.end('Erro ao carregar recurso');
				return;
			}
			res.writeHead(200, { 'Content-Type': contentType });
			res.end(content);
		});
	});
});

// WebSocket Server
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
	const remoteIp = req.socket.remoteAddress || '127.0.0.1';
	const url = new URL(req.url, `http://${req.headers.host}`);
	const isProctor = url.searchParams.get('role') === 'proctor' || url.pathname.includes('/proctor');

	if (isProctor) {
		proctorClients.add(ws);
		console.log(`[Exam Proctor] Professor conectado ao painel a partir de ${remoteIp}`);

		// Send initial snapshot
		ws.send(JSON.stringify({
			type: 'SNAPSHOT',
			students: Array.from(students.values()),
			events: events.slice(-500)
		}));

		ws.on('close', () => {
			proctorClients.delete(ws);
			console.log(`[Exam Proctor] Professor desconectado do painel (${remoteIp})`);
		});

		ws.on('message', (data) => {
			try {
				const msg = JSON.parse(data.toString());
				if (msg.action === 'PING') {
					ws.send(JSON.stringify({ type: 'PONG' }));
				}
			} catch { }
		});

		return;
	}

	// Student VS Code Client
	let currentStudentId = null;

	ws.on('message', (data) => {
		try {
			const event = JSON.parse(data.toString());
			if (!event.eventType || !event.studentId) {
				return;
			}

			currentStudentId = event.studentId;
			const student = getOrCreateStudent(event.studentId, event.studentName, event.machineInfo, remoteIp);
			updateStudentWithEvent(student, event);

			// Append to in-memory events
			events.push(event);
			if (events.length > 5000) {
				events.shift();
			}

			// Append to persistent log file
			writeToAuditLog(event);

			// Log critical events in server console
			if (event.severity === 'alert') {
				console.log(`🚨 [ALERTA] ${student.name} (${student.id}): ${event.eventType} - ${event.details?.reason || ''}`);
			} else if (event.severity === 'warning') {
				console.log(`⚠️  [AVISO] ${student.name} (${student.id}): ${event.eventType} - ${event.details?.reason || ''}`);
			}

			// Broadcast event and updated student summary to teacher dashboards
			broadcastToProctors({
				type: 'EVENT',
				event,
				student
			});

		} catch (err) {
			console.error('[Exam Proctor] Erro ao processar mensagem do aluno:', err);
		}
	});

	ws.on('close', () => {
		if (currentStudentId) {
			const student = students.get(currentStudentId);
			if (student) {
				student.status = 'offline';
				broadcastToProctors({
					type: 'STUDENT_UPDATE',
					student
				});
				console.log(`[Exam Proctor] Aluno desconectado: ${student.name} (${student.id})`);
			}
		}
	});

	ws.on('error', (err) => {
		console.warn(`[Exam Proctor] Erro no socket do cliente (${remoteIp}):`, err.message);
	});
});

function getLanIps() {
	const interfaces = os.networkInterfaces();
	const ips = [];
	for (const name of Object.keys(interfaces)) {
		// Filter out virtual, container and bridge interfaces
		if (/^(docker|br-|veth|vmnet|vboxnet|tun|tap|virbr)/i.test(name)) {
			continue;
		}
		for (const iface of interfaces[name] || []) {
			if (iface.family === 'IPv4' && !iface.internal) {
				ips.push({ name, address: iface.address });
			}
		}
	}
	return ips;
}

function openBrowser(url) {
	if (process.env.NO_OPEN || process.argv.includes('--no-open')) {
		return;
	}
	const cmd = process.platform === 'win32' ? `start "" "${url}"` :
		process.platform === 'darwin' ? `open "${url}"` :
		`xdg-open "${url}"`;
	exec(cmd, () => {});
}

server.listen(PORT, HOST, () => {
	const lanIps = getLanIps();
	const ipLines = lanIps.length > 0
		? lanIps.map(ip => `     -> ws://${ip.address}:${PORT} (${ip.name})`).join('\n')
		: `     -> ws://localhost:${PORT}`;

	console.log(`
==================================================================
  🛡️  UNIVERTIX EXAM SHIELD — PAINEL DO PROFESSOR (PORTÁTIL)
==================================================================
  📍 Painel do Professor: http://localhost:${PORT}
  📡 Endereços IP para os Alunos conectarem:
${ipLines}
  📁 Arquivo de Auditoria: ${sessionLogFile}
==================================================================
  Pressione Ctrl+C para encerrar o servidor.
	`);

	openBrowser(`http://localhost:${PORT}`);
});

process.on('SIGINT', () => {
	console.log('\n[Exam Proctor] Encerrando servidor e fechando logs de auditoria...');
	logStream.end();
	process.exit(0);
});
