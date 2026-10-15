/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const IExamAuditService = createDecorator<IExamAuditService>('examAuditService');

export type ExamAuditEventType =
	| 'STUDENT_CONNECTED'
	| 'STUDENT_HEARTBEAT'
	| 'WINDOW_BLURRED'
	| 'WINDOW_FOCUSED'
	| 'EXTERNAL_PASTE'
	| 'INTERNAL_COPY'
	| 'EXTERNAL_FILE_ACCESS'
	| 'SUSPICIOUS_TYPING_BURST'
	| 'PEN_DRIVE_DETECTED';

export type ExamAuditSeverity = 'info' | 'warning' | 'alert';

export interface IExamAuditDetails {
	readonly file?: string;
	readonly line?: number;
	readonly column?: number;
	readonly charCount?: number;
	readonly lineCount?: number;
	readonly snippetPreview?: string;
	readonly fullSnippet?: string;
	readonly durationSeconds?: number;
	readonly devicePath?: string;
	readonly reason?: string;
	readonly activeFile?: string;
	readonly selection?: string;
}

export interface IExamAuditEvent {
	readonly id: string;
	readonly timestamp: string;
	readonly eventType: ExamAuditEventType;
	readonly severity: ExamAuditSeverity;
	readonly studentId: string;
	readonly studentName: string;
	readonly machineInfo: {
		readonly platform?: string;
		readonly hostname?: string;
		readonly username?: string;
	};
	readonly details: IExamAuditDetails;
}

export interface IExamAuditService {
	readonly _serviceBrand: undefined;
	readonly onDidAuditEvent: Event<IExamAuditEvent>;
	recordEvent(type: ExamAuditEventType, severity: ExamAuditSeverity, details: IExamAuditDetails): void;
	getStudentName(): string;
	getStudentId(): string;
	setStudentName(name: string): void;
	promptStudentName(): Promise<void>;
	isConnectedToProctor(): boolean;
	getServerUrl(): string;
	reconnect(): void;
	testConnection(targetUrl?: string): Promise<{ success: boolean; message: string }>;
}

export function normalizeServerUrl(rawInput: string): string {
	let clean = (rawInput || '').trim();
	if (!clean) {
		return 'ws://localhost:3001';
	}
	// Remove protocol if provided (http://, https://, ws://, wss://)
	clean = clean.replace(/^(http|ws)s?:\/\//i, '');
	// Remove trailing paths/slashes
	clean = clean.replace(/\/.*$/, '');
	// If no port specified, default to 3001
	if (!clean.includes(':')) {
		clean = `${clean}:3001`;
	}
	return `ws://${clean}`;
}

export const EXAM_AUDIT_ENABLED_SETTING = 'exam.audit.enabled';
export const EXAM_AUDIT_SERVER_URL_SETTING = 'exam.audit.serverUrl';
export const EXAM_AUDIT_STUDENT_NAME_SETTING = 'exam.audit.studentName';
export const EXAM_AUDIT_PASTE_THRESHOLD_SETTING = 'exam.audit.pasteThresholdChars';
export const EXAM_AUDIT_BLUR_ALERT_THRESHOLD_SETTING = 'exam.audit.blurAlertThresholdSeconds';
export const EXAM_AUDIT_BLOCK_EXTERNAL_FILES_SETTING = 'exam.audit.blockExternalFiles';
