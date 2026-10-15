/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ConfigurationTarget, IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import {
	EXAM_AUDIT_BLUR_ALERT_THRESHOLD_SETTING,
	EXAM_AUDIT_ENABLED_SETTING,
	EXAM_AUDIT_PASTE_THRESHOLD_SETTING,
	EXAM_AUDIT_SERVER_URL_SETTING,
	EXAM_AUDIT_STUDENT_NAME_SETTING,
	IExamAuditService,
	normalizeServerUrl
} from '../common/examAudit.js';
import { ExamAuditService } from './examAuditService.js';

// Register service singleton
registerSingleton(IExamAuditService, ExamAuditService, InstantiationType.Eager);

export class ExamAuditContribution {
	constructor(
		@IExamAuditService _examAuditService: IExamAuditService
	) {
		// Instantiated eagerly to start monitoring
	}
}

registerWorkbenchContribution2('ExamAuditContribution', ExamAuditContribution, WorkbenchPhase.AfterRestored);

// Register configuration settings
const configurationRegistry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);
configurationRegistry.registerConfiguration({
	id: 'examAudit',
	order: 10,
	title: localize('examAudit.title', "Auditoria de Provas Univertix"),
	type: 'object',
	properties: {
		[EXAM_AUDIT_ENABLED_SETTING]: {
			type: 'boolean',
			default: true,
			description: localize('exam.audit.enabled.desc', "Habilita a auditoria e monitoramento de integridade da prova.")
		},
		[EXAM_AUDIT_SERVER_URL_SETTING]: {
			type: 'string',
			default: 'ws://localhost:3001',
			description: localize('exam.audit.serverUrl.desc', "URL WebSocket do painel do professor/servidor de auditoria.")
		},
		[EXAM_AUDIT_STUDENT_NAME_SETTING]: {
			type: 'string',
			default: '',
			description: localize('exam.audit.studentName.desc', "Nome ou matrícula do aluno para identificação na prova.")
		},
		[EXAM_AUDIT_PASTE_THRESHOLD_SETTING]: {
			type: 'number',
			default: 20,
			description: localize('exam.audit.pasteThreshold.desc', "Tamanho mínimo em caracteres para considerar um trecho colado suspeito de fonte externa.")
		},
		[EXAM_AUDIT_BLUR_ALERT_THRESHOLD_SETTING]: {
			type: 'number',
			default: 10,
			description: localize('exam.audit.blurAlertThreshold.desc', "Tempo em segundos fora do VS Code para gerar alerta de ausência.")
		}
	}
});

// Register command to quickly connect or change server URL
registerAction2(class ConfigureExamServerAction extends Action2 {
	constructor() {
		super({
			id: 'univertix.examAudit.configureServer',
			title: localize2('examAudit.configureServer', "Univertix: Conectar ao Servidor da Prova"),
			category: localize2('univertixCategory', "Univertix Exam Shield"),
			f1: true
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const examAuditService = accessor.get(IExamAuditService);
		const quickInputService = accessor.get(IQuickInputService);
		const configurationService = accessor.get(IConfigurationService);
		const notificationService = accessor.get(INotificationService);

		const currentUrl = examAuditService.getServerUrl();
		const isConnected = examAuditService.isConnectedToProctor();
		const studentName = examAuditService.getStudentName();

		const input = await quickInputService.input({
			title: 'Univertix Exam Shield — Servidor da Prova',
			prompt: isConnected
				? `Conectado ao servidor do professor (${studentName}). Digite novo IP se desejar alterar:`
				: `Desconectado do servidor. Informe o IP ou URL do servidor do professor (ex: 192.168.1.100:3001):`,
			value: currentUrl,
			placeHolder: '192.168.1.100:3001'
		});

		if (!input || input.trim().length === 0) {
			return;
		}

		const formattedUrl = normalizeServerUrl(input);

		await configurationService.updateValue(EXAM_AUDIT_SERVER_URL_SETTING, formattedUrl, ConfigurationTarget.USER);
		examAuditService.reconnect();

		const result = await examAuditService.testConnection(formattedUrl);
		if (result.success) {
			notificationService.notify({
				severity: Severity.Info,
				message: `🟢 ${result.message}`
			});
		} else {
			notificationService.notify({
				severity: Severity.Warning,
				message: `🔴 ${result.message}`
			});
		}
	}
});

// Register command to set student name
registerAction2(class SetStudentNameAction extends Action2 {
	constructor() {
		super({
			id: 'univertix.examAudit.setName',
			title: localize2('examAudit.setName', "Univertix: Informar Nome / Matrícula do Aluno"),
			category: localize2('univertixCategory', "Univertix Exam Shield"),
			f1: true
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const examAuditService = accessor.get(IExamAuditService);
		await examAuditService.promptStudentName();
	}
});

// Register statusbar menu action
registerAction2(class ExamMenuAction extends Action2 {
	constructor() {
		super({
			id: 'univertix.examAudit.menu',
			title: localize2('examAudit.menu', "Univertix: Menu da Prova"),
			category: localize2('univertixCategory', "Univertix Exam Shield"),
			f1: true
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const examAuditService = accessor.get(IExamAuditService);
		const quickInputService = accessor.get(IQuickInputService);
		const configurationService = accessor.get(IConfigurationService);
		const notificationService = accessor.get(INotificationService);

		const studentName = examAuditService.getStudentName();
		const serverUrl = examAuditService.getServerUrl();
		const isConnected = examAuditService.isConnectedToProctor();

		const pick = await quickInputService.pick([
			{
				id: 'setName',
				label: '$(account) Identificação do Aluno',
				description: studentName,
				detail: 'Alterar ou confirmar seu nome completo e matrícula'
			},
			{
				id: 'setServer',
				label: '$(broadcast) Servidor do Professor',
				description: `${serverUrl} (${isConnected ? '🟢 Conectado' : '🔴 Desconectado'})`,
				detail: 'Configurar o endereço IP da máquina do professor'
			},
			{
				id: 'testConn',
				label: '$(debug-disconnect) Testar Conexão com o Servidor',
				description: serverUrl,
				detail: 'Testar acessibilidade e diagnóstico de rede/firewall'
			},
			{
				id: 'status',
				label: '$(shield) Status da Auditoria de Prova',
				description: isConnected ? 'Ativo e Transmitindo em Tempo Real' : 'Gravando Localmente',
				detail: 'Visualizar informações da sessão atual'
			}
		], {
			title: '🛡️ Univertix Exam Shield — Opções da Prova',
			placeHolder: 'Selecione uma opção:'
		});

		if (!pick) {
			return;
		}

		if (pick.id === 'setName') {
			await examAuditService.promptStudentName();
		} else if (pick.id === 'setServer') {
			const input = await quickInputService.input({
				title: 'Univertix Exam Shield — Servidor da Prova',
				prompt: `Informe o IP ou URL do servidor do professor (ex: 192.168.1.100:3001):`,
				value: serverUrl,
				placeHolder: '192.168.1.100:3001'
			});
			if (input && input.trim().length > 0) {
				const formattedUrl = normalizeServerUrl(input);
				await configurationService.updateValue(EXAM_AUDIT_SERVER_URL_SETTING, formattedUrl, ConfigurationTarget.USER);
				examAuditService.reconnect();
				const result = await examAuditService.testConnection(formattedUrl);
				if (result.success) {
					notificationService.notify({
						severity: Severity.Info,
						message: `🟢 ${result.message}`
					});
				} else {
					notificationService.notify({
						severity: Severity.Warning,
						message: `🔴 ${result.message}`
					});
				}
			}
		} else if (pick.id === 'testConn') {
			notificationService.notify({
				severity: Severity.Info,
				message: `Testando conexão com ${serverUrl}...`
			});
			const result = await examAuditService.testConnection(serverUrl);
			notificationService.notify({
				severity: result.success ? Severity.Info : Severity.Warning,
				message: result.success ? `🟢 ${result.message}` : `🔴 ${result.message}`
			});
		} else if (pick.id === 'status') {
			notificationService.notify({
				severity: isConnected ? Severity.Info : Severity.Warning,
				message: `[Univertix Exam Shield]\nAluno: ${studentName}\nServidor: ${serverUrl} (${isConnected ? 'Conectado' : 'Desconectado'})\nAuditoria de integridade ativa.`
			});
		}
	}
});


