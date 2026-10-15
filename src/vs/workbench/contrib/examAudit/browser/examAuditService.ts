/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener } from '../../../../base/browser/dom.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { isLinux, isMacintosh, isWindows } from '../../../../base/common/platform.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
import { IClipboardService } from '../../../../platform/clipboard/common/clipboardService.js';
import { ConfigurationTarget, IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { EditorResourceAccessor } from '../../../common/editor.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IHostService } from '../../../services/host/browser/host.js';
import { IStatusbarEntryAccessor, IStatusbarService, StatusbarAlignment } from '../../../services/statusbar/browser/statusbar.js';
import {
	EXAM_AUDIT_BLUR_ALERT_THRESHOLD_SETTING,
	EXAM_AUDIT_ENABLED_SETTING,
	EXAM_AUDIT_PASTE_THRESHOLD_SETTING,
	EXAM_AUDIT_SERVER_URL_SETTING,
	EXAM_AUDIT_STUDENT_NAME_SETTING,
	ExamAuditEventType,
	ExamAuditSeverity,
	IExamAuditDetails,
	IExamAuditEvent,
	IExamAuditService
} from '../common/examAudit.js';

export class ExamAuditService extends Disposable implements IExamAuditService {

	declare readonly _serviceBrand: undefined;

	private readonly _onDidAuditEvent = this._register(new Emitter<IExamAuditEvent>());
	readonly onDidAuditEvent: Event<IExamAuditEvent> = this._onDidAuditEvent.event;

	private readonly _studentId: string;
	private _studentName: string;
	private _serverUrl: string = 'ws://localhost:3001';
	private _pasteThresholdChars: number = 20;
	private _blurAlertThresholdSeconds: number = 10;
	private _enabled: boolean = true;

	private _ws: WebSocket | null = null;
	private _isConnected: boolean = false;
	private _reconnectTimer: any = null;
	private _heartbeatTimer: any = null;
	private readonly _eventQueue: IExamAuditEvent[] = [];

	private readonly _internalCopies = new Map<string, number>();
	private _blurTimestamp: number | null = null;
	private _lastHandledPasteHash: string = '';
	private _lastHandledPasteTime: number = 0;
	private readonly _flaggedFiles = new Map<string, number>();
	private _statusbarEntry: IStatusbarEntryAccessor | null = null;

	constructor(
		@IClipboardService private readonly clipboardService: IClipboardService,
		@ICodeEditorService private readonly codeEditorService: ICodeEditorService,
		@IHostService private readonly hostService: IHostService,
		@IEditorService private readonly editorService: IEditorService,
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ILogService private readonly logService: ILogService,
		@IStatusbarService private readonly statusbarService: IStatusbarService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@INotificationService private readonly notificationService: INotificationService
	) {
		super();

		this._studentId = this._resolveStudentId();
		this._studentName = this._resolveStudentName();

		this._readConfiguration();
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('exam.audit')) {
				this._readConfiguration();
			}
		}));

		if (this._enabled) {
			this._initStatusbar();
			this._interceptClipboard();
			this._listenToEditors();
			this._listenToWindowFocus();
			this._listenToFileAccess();
			this._connectWebSocket();
			this._startHeartbeat();

			if (!this._studentName || this._studentName.trim().length === 0) {
				setTimeout(() => {
					this.promptStudentName();
				}, 1200);
			} else {
				this.recordEvent('STUDENT_CONNECTED', 'info', {
					reason: `Sessão de prova iniciada: ${this._studentName}`
				});
			}
		}
	}

	override dispose(): void {
		if (this._reconnectTimer) {
			clearTimeout(this._reconnectTimer);
		}
		if (this._heartbeatTimer) {
			clearInterval(this._heartbeatTimer);
		}
		if (this._ws) {
			try { this._ws.close(); } catch { }
		}
		this._statusbarEntry?.dispose();
		super.dispose();
	}

	getStudentId(): string {
		return this._studentId;
	}

	getStudentName(): string {
		return this._studentName || 'Aluno Não Identificado';
	}

	setStudentName(name: string): void {
		const clean = name.trim();
		this._studentName = clean;
		try {
			mainWindow.localStorage.setItem('univertix_exam_student_name', clean);
		} catch { }
		this.configurationService.updateValue(EXAM_AUDIT_STUDENT_NAME_SETTING, clean, ConfigurationTarget.USER);
		this._updateStatusbar(this._isConnected);
		this.recordEvent('STUDENT_CONNECTED', 'info', {
			reason: `Aluno identificado: ${clean}`
		});
	}

	async promptStudentName(): Promise<void> {
		const input = await this.quickInputService.input({
			title: '🎓 Identificação do Aluno — Univertix Exam Shield',
			prompt: 'Por favor, digite seu NOME COMPLETO e MATRÍCULA para identificação na prova:',
			value: this._studentName,
			placeHolder: 'Ex: Lucas Silva - Matrícula 202410123',
			ignoreFocusLost: true,
			validateInput: async (val) => {
				if (!val || val.trim().length < 3) {
					return 'Por favor, digite seu nome completo.';
				}
				return null;
			}
		});

		if (input && input.trim().length > 0) {
			this.setStudentName(input.trim());
			this.notificationService.notify({
				severity: Severity.Info,
				message: `Identificação confirmada: ${input.trim()}`
			});
		}
	}

	isConnectedToProctor(): boolean {
		return this._isConnected;
	}

	getServerUrl(): string {
		return this._serverUrl;
	}

	reconnect(): void {
		this._readConfiguration();
		this._connectWebSocket();
	}

	recordEvent(type: ExamAuditEventType, severity: ExamAuditSeverity, details: IExamAuditDetails): void {
		if (!this._enabled) {
			return;
		}

		const event: IExamAuditEvent = {
			id: generateUuid(),
			timestamp: new Date().toISOString(),
			eventType: type,
			severity,
			studentId: this._studentId,
			studentName: this._studentName,
			machineInfo: {
				platform: isWindows ? 'Windows' : isMacintosh ? 'macOS' : isLinux ? 'Linux' : 'Unknown',
				hostname: this._resolveHostname(),
				username: this._resolveUsername()
			},
			details
		};

		this.logService.info(`[ExamAudit] [${severity.toUpperCase()}] ${type}:`, details);
		this._onDidAuditEvent.fire(event);

		this._sendOrQueueEvent(event);
	}

	private _readConfiguration(): void {
		this._enabled = this.configurationService.getValue<boolean>(EXAM_AUDIT_ENABLED_SETTING) ?? true;
		this._serverUrl = this.configurationService.getValue<string>(EXAM_AUDIT_SERVER_URL_SETTING) || 'ws://localhost:3001';
		this._pasteThresholdChars = this.configurationService.getValue<number>(EXAM_AUDIT_PASTE_THRESHOLD_SETTING) ?? 20;
		this._blurAlertThresholdSeconds = this.configurationService.getValue<number>(EXAM_AUDIT_BLUR_ALERT_THRESHOLD_SETTING) ?? 10;

		const configuredName = this.configurationService.getValue<string>(EXAM_AUDIT_STUDENT_NAME_SETTING);
		if (configuredName && configuredName.trim().length > 0) {
			this._studentName = configuredName.trim();
		}
	}

	private _resolveStudentId(): string {
		try {
			const stored = mainWindow.localStorage.getItem('univertix_exam_student_id');
			if (stored) {
				return stored;
			}
			const newId = 'aluno_' + generateUuid().substring(0, 8);
			mainWindow.localStorage.setItem('univertix_exam_student_id', newId);
			return newId;
		} catch {
			return 'aluno_' + generateUuid().substring(0, 8);
		}
	}

	private _resolveStudentName(): string {
		try {
			const stored = mainWindow.localStorage.getItem('univertix_exam_student_name');
			if (stored && stored.trim().length > 0) {
				return stored.trim();
			}
		} catch { }

		const configuredName = this.configurationService.getValue<string>(EXAM_AUDIT_STUDENT_NAME_SETTING);
		if (configuredName && configuredName.trim().length > 0) {
			return configuredName.trim();
		}

		return '';
	}

	private _resolveUsername(): string {
		if (typeof process !== 'undefined' && process.env) {
			return process.env.USER || process.env.USERNAME || process.env.LOGNAME || 'unknown';
		}
		return 'unknown';
	}

	private _resolveHostname(): string {
		if (typeof process !== 'undefined' && process.env) {
			return process.env.HOSTNAME || process.env.COMPUTERNAME || 'host-aluno';
		}
		return 'host-aluno';
	}

	private _initStatusbar(): void {
		try {
			const displayName = this._studentName ? `Prova: ${this._studentName}` : 'Prova (Informe seu Nome)';
			this._statusbarEntry = this.statusbarService.addEntry(
				{
					name: 'Exam Proctoring Status',
					text: `$(shield) ${displayName}`,
					ariaLabel: 'Ambiente de Prova Univertix Monitorado',
					tooltip: `Aluno: ${this._studentName || 'Não identificado'} — Clique para opções da prova`,
					command: 'univertix.examAudit.menu',
					backgroundColor: undefined
				},
				'univertix.examAudit',
				StatusbarAlignment.RIGHT,
				1000
			);
		} catch (err) {
			this.logService.warn('[ExamAudit] Error initializing statusbar:', err);
		}
	}

	private _updateStatusbar(connected: boolean): void {
		if (this._statusbarEntry) {
			const displayName = this._studentName ? `Prova: ${this._studentName}` : 'Prova (Informe seu Nome)';
			const icon = connected ? '$(shield)' : '$(warning)';
			this._statusbarEntry.update({
				name: 'Exam Proctoring Status',
				text: `${icon} ${displayName}`,
				ariaLabel: 'Ambiente de Prova Univertix Monitorado',
				tooltip: `Aluno: ${this._studentName || 'Não identificado'} | Servidor: ${connected ? 'Conectado' : 'Offline'} (${this._serverUrl}) — Clique para opções`,
				command: 'univertix.examAudit.menu'
			});
		}
	}

	// ==================== CLIPBOARD AUDIT ====================

	private _interceptClipboard(): void {
		// Hook clipboardService.writeText
		const originalWriteText = this.clipboardService.writeText.bind(this.clipboardService);
		this.clipboardService.writeText = async (text: string, type?: string) => {
			this._recordInternalCopy(text, 'clipboardService.writeText');
			return originalWriteText(text, type);
		};

		// Listen for DOM copy/cut events in main window
		if (mainWindow?.document) {
			this._register(addDisposableListener(mainWindow.document, 'copy', () => {
				const selection = mainWindow.getSelection()?.toString();
				if (selection && selection.length > 0) {
					this._recordInternalCopy(selection, 'DOM copy');
				}
			}));

			this._register(addDisposableListener(mainWindow.document, 'cut', () => {
				const selection = mainWindow.getSelection()?.toString();
				if (selection && selection.length > 0) {
					this._recordInternalCopy(selection, 'DOM cut');
				}
			}));
		}
	}

	private _recordInternalCopy(text: string, source: string): void {
		if (!text) {
			return;
		}
		const normalized = this._normalizeSnippet(text);
		if (normalized.length === 0) {
			return;
		}

		const now = Date.now();
		this._internalCopies.set(normalized, now);

		// Also register individual lines if it's multiline
		const lines = normalized.split('\n').map(l => l.trim()).filter(l => l.length > 10);
		for (const line of lines) {
			this._internalCopies.set(line, now);
		}

		// Prune cache if it grows beyond 300 entries
		if (this._internalCopies.size > 300) {
			const oldestThreshold = now - (4 * 60 * 60 * 1000); // 4 hours
			for (const [key, timestamp] of this._internalCopies.entries()) {
				if (timestamp < oldestThreshold) {
					this._internalCopies.delete(key);
				}
			}
		}

		this.recordEvent('INTERNAL_COPY', 'info', {
			charCount: text.length,
			lineCount: text.split('\n').length,
			reason: `Cópia legítima interna no VS Code (${source})`
		});
	}

	private _isInternalCopy(text: string): boolean {
		const normalized = this._normalizeSnippet(text);
		if (normalized.length === 0) {
			return true;
		}

		// Exact match
		if (this._internalCopies.has(normalized)) {
			return true;
		}

		// Check if it's a known line or substring of any internal copy
		for (const [internal] of this._internalCopies.entries()) {
			if (internal.includes(normalized) || (normalized.length > 25 && internal.startsWith(normalized.substring(0, 25)))) {
				return true;
			}
		}

		return false;
	}

	private _normalizeSnippet(text: string): string {
		return text.replace(/\r\n/g, '\n').trim();
	}

	private _listenToEditors(): void {
		const editorStores = new Map<ICodeEditor, DisposableStore>();

		const hookEditor = (editor: ICodeEditor) => {
			if (editorStores.has(editor)) {
				return;
			}
			const store = new DisposableStore();
			editorStores.set(editor, store);

			// 1. onDidPaste
			store.add(editor.onDidPaste((e) => {
				const model = editor.getModel();
				if (!model) {
					return;
				}
				const pastedText = model.getValueInRange(e.range);
				this._processPaste(pastedText, model.uri.fsPath, e.range.startLineNumber, e.range.startColumn);
			}));

			// 2. onDidChangeModelContent (catches drag-drop or non-keyboard insertions)
			store.add(editor.onDidChangeModelContent((e) => {
				if (e.isUndoing || e.isRedoing) {
					return;
				}
				const model = editor.getModel();
				if (!model) {
					return;
				}
				for (const change of e.changes) {
					if (change.text.length >= this._pasteThresholdChars * 2) {
						this._processPotentialInsertion(change.text, model.uri.fsPath, change.range.startLineNumber, change.range.startColumn);
					}
				}
			}));

			store.add(editor.onDidDispose(() => {
				store.dispose();
				editorStores.delete(editor);
			}));
		};

		this._register(this.codeEditorService.onCodeEditorAdd(editor => hookEditor(editor)));
		for (const editor of this.codeEditorService.listCodeEditors()) {
			hookEditor(editor);
		}
	}

	private _processPaste(text: string, file: string, line: number, column: number): void {
		if (!text || text.length < this._pasteThresholdChars) {
			return;
		}

		const now = Date.now();
		const hash = this._hashString(text + file + line);
		if (this._lastHandledPasteHash === hash && (now - this._lastHandledPasteTime) < 800) {
			return; // Deduplicate
		}
		this._lastHandledPasteHash = hash;
		this._lastHandledPasteTime = now;

		const isInternal = this._isInternalCopy(text);
		if (!isInternal) {
			// External paste detected!
			const lineCount = text.split('\n').length;
			const preview = text.length > 200 ? text.substring(0, 200) + '...' : text;

			this.recordEvent('EXTERNAL_PASTE', 'alert', {
				file,
				line,
				column,
				charCount: text.length,
				lineCount,
				snippetPreview: preview,
				fullSnippet: text,
				reason: '🚨 Código colado de fonte externa (ChatGPT/Navegador/Pen Drive)'
			});
		}
	}

	private _processPotentialInsertion(text: string, file: string, line: number, column: number): void {
		const now = Date.now();
		const hash = this._hashString(text + file + line);
		if (this._lastHandledPasteHash === hash && (now - this._lastHandledPasteTime) < 1000) {
			return;
		}

		if (!this._isInternalCopy(text)) {
			this._lastHandledPasteHash = hash;
			this._lastHandledPasteTime = now;

			const preview = text.length > 200 ? text.substring(0, 200) + '...' : text;
			this.recordEvent('SUSPICIOUS_TYPING_BURST', 'alert', {
				file,
				line,
				column,
				charCount: text.length,
				lineCount: text.split('\n').length,
				snippetPreview: preview,
				fullSnippet: text,
				reason: 'Inserção súbita de grande bloco de código não digitado'
			});
		}
	}

	// ==================== WINDOW FOCUS (ALT+TAB) AUDIT ====================

	private _listenToWindowFocus(): void {
		this._register(this.hostService.onDidChangeFocus(hasFocus => {
			if (!this._enabled) {
				return;
			}
			const now = Date.now();
			if (!hasFocus) {
				this._blurTimestamp = now;
				this.recordEvent('WINDOW_BLURRED', 'info', {
					reason: 'Aluno saiu da janela do VS Code (Alt+Tab / segundo plano)',
					activeFile: this._getActiveFilePath()
				});
			} else {
				if (this._blurTimestamp) {
					const durationSeconds = Math.round((now - this._blurTimestamp) / 1000);
					this._blurTimestamp = null;
					const isLongAway = durationSeconds >= this._blurAlertThresholdSeconds;
					const severity: ExamAuditSeverity = durationSeconds >= 30 ? 'alert' : isLongAway ? 'warning' : 'info';

					this.recordEvent('WINDOW_FOCUSED', severity, {
						durationSeconds,
						reason: `Aluno retornou ao VS Code após ${durationSeconds}s fora`,
						activeFile: this._getActiveFilePath()
					});
				}
			}
		}));
	}

	// ==================== USB / EXTERNAL FILES AUDIT ====================

	private _listenToFileAccess(): void {
		// Active editor change
		this._register(this.editorService.onDidActiveEditorChange(() => {
			const activeEditor = this.editorService.activeEditor;
			const uri = EditorResourceAccessor.getCanonicalUri(activeEditor);
			if (uri && uri.scheme === 'file') {
				this._inspectFileUri(uri);
			}
		}));

		// File operations (open, save, create)
		this._register(this.fileService.onDidRunOperation(e => {
			if (e.resource && e.resource.scheme === 'file') {
				this._inspectFileUri(e.resource);
			}
		}));
	}

	private _inspectFileUri(uri: URI): void {
		const fsPath = uri.fsPath;
		if (!fsPath) {
			return;
		}

		const now = Date.now();
		const lastFlagged = this._flaggedFiles.get(fsPath);
		if (lastFlagged && (now - lastFlagged) < 15000) {
			return; // Don't spam the same file within 15 seconds
		}

		// 1. Check for removable drives / USB signatures
		const isRemovable = this._isRemovableDrivePath(fsPath);
		if (isRemovable) {
			this._flaggedFiles.set(fsPath, now);
			this.recordEvent('PEN_DRIVE_DETECTED', 'alert', {
				file: fsPath,
				devicePath: fsPath,
				reason: '🚨 Arquivo acessado diretamente de Pen Drive ou Mídia Removível!'
			});
			return;
		}

		// 2. Check if file is outside the exam workspace
		const workspaceFolders = this.contextService.getWorkspace().folders;
		if (workspaceFolders.length > 0) {
			const isInsideWorkspace = workspaceFolders.some(folder => fsPath.startsWith(folder.uri.fsPath));
			if (!isInsideWorkspace && !this._isIgnoredSystemPath(fsPath)) {
				this._flaggedFiles.set(fsPath, now);
				this.recordEvent('EXTERNAL_FILE_ACCESS', 'warning', {
					file: fsPath,
					reason: 'Arquivo aberto fora da pasta oficial da prova'
				});
			}
		}
	}

	private _isRemovableDrivePath(fsPath: string): boolean {
		const normalized = fsPath.replace(/\\/g, '/');

		// Linux USB mount paths: /media/*, /run/media/*, /mnt/*
		if (/^\/(media|run\/media|mnt)(\/|$)/i.test(normalized)) {
			return true;
		}

		// Windows removable drives (letters D through Z)
		if (/^[d-z]:\//i.test(normalized)) {
			// Check if current workspace is NOT on that drive
			const workspaceFolders = this.contextService.getWorkspace().folders;
			const isWorkspaceDrive = workspaceFolders.some(f => f.uri.fsPath.replace(/\\/g, '/').toLowerCase().startsWith(normalized.substring(0, 3).toLowerCase()));
			if (!isWorkspaceDrive) {
				return true;
			}
		}

		// macOS removable volumes
		if (/^\/Volumes\/(?!Macintosh HD)/i.test(normalized)) {
			return true;
		}

		return false;
	}

	private _isIgnoredSystemPath(fsPath: string): boolean {
		const normalized = fsPath.replace(/\\/g, '/').toLowerCase();
		return normalized.includes('/tmp/') ||
			normalized.includes('/.vscode') ||
			normalized.includes('/appdata/') ||
			normalized.includes('/node_modules/');
	}

	private _getActiveFilePath(): string | undefined {
		const uri = EditorResourceAccessor.getCanonicalUri(this.editorService.activeEditor);
		return uri?.fsPath;
	}

	// ==================== WEBSOCKET TRANSPORT ====================

	private _connectWebSocket(): void {
		if (this._ws) {
			try {
				this._ws.onopen = null;
				this._ws.onclose = null;
				this._ws.onerror = null;
				this._ws.onmessage = null;
				this._ws.close();
			} catch { }
			this._ws = null;
		}

		try {
			this._ws = new WebSocket(this._serverUrl);

			this._ws.onopen = () => {
				this._isConnected = true;
				this.logService.info('[ExamAudit] Connected to proctor server at', this._serverUrl);
				this._updateStatusbar(true);
				this._flushEventQueue();
			};

			this._ws.onclose = () => {
				this._isConnected = false;
				this._updateStatusbar(false);
				this._scheduleReconnect();
			};

			this._ws.onerror = () => {
				this._isConnected = false;
				this._updateStatusbar(false);
			};
		} catch (err) {
			this._isConnected = false;
			this._updateStatusbar(false);
			this._scheduleReconnect();
		}
	}

	private _scheduleReconnect(): void {
		if (this._reconnectTimer) {
			return;
		}
		this._reconnectTimer = setTimeout(() => {
			this._reconnectTimer = null;
			this._connectWebSocket();
		}, 3000);
	}

	private _startHeartbeat(): void {
		this._heartbeatTimer = setInterval(() => {
			if (!this._enabled) {
				return;
			}
			const heartbeat: IExamAuditEvent = {
				id: generateUuid(),
				timestamp: new Date().toISOString(),
				eventType: 'STUDENT_HEARTBEAT',
				severity: 'info',
				studentId: this._studentId,
				studentName: this._studentName,
				machineInfo: {
					platform: isWindows ? 'Windows' : isMacintosh ? 'macOS' : isLinux ? 'Linux' : 'Unknown',
					hostname: this._resolveHostname(),
					username: this._resolveUsername()
				},
				details: {
					activeFile: this._getActiveFilePath(),
					durationSeconds: this._blurTimestamp ? Math.round((Date.now() - this._blurTimestamp) / 1000) : 0
				}
			};

			this._sendOrQueueEvent(heartbeat);
		}, 10000);
	}

	private _sendOrQueueEvent(event: IExamAuditEvent): void {
		if (this._isConnected && this._ws && this._ws.readyState === WebSocket.OPEN) {
			try {
				this._ws.send(JSON.stringify(event));
				return;
			} catch (err) {
				this.logService.warn('[ExamAudit] Failed to send event over WebSocket:', err);
			}
		}

		// Queue event for when connection recovers (max 500 queued events)
		if (this._eventQueue.length < 500) {
			this._eventQueue.push(event);
		}
	}

	private _flushEventQueue(): void {
		if (!this._ws || this._ws.readyState !== WebSocket.OPEN) {
			return;
		}

		while (this._eventQueue.length > 0) {
			const event = this._eventQueue.shift();
			if (event) {
				try {
					this._ws.send(JSON.stringify(event));
				} catch {
					this._eventQueue.unshift(event);
					break;
				}
			}
		}
	}

	private _hashString(str: string): string {
		let hash = 0;
		for (let i = 0; i < str.length; i++) {
			hash = ((hash << 5) - hash) + str.charCodeAt(i);
			hash |= 0;
		}
		return hash.toString();
	}
}
