/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILogService } from '../../../../platform/log/common/log.js';
import { ILanguageModelsService } from '../../chat/common/languageModels.js';
import { InlineChatConfigKeys } from '../common/inlineChat.js';
import { createDefaultModelArrays, DefaultModelContribution } from '../../chat/browser/defaultModelContribution.js';

const arrays = createDefaultModelArrays();

export class InlineChatDefaultModel extends DefaultModelContribution {
	static readonly ID = 'workbench.contrib.inlineChatDefaultModel';

	static readonly modelIds = arrays.modelIds;
	static readonly modelLabels = arrays.modelLabels;
	static readonly modelDescriptions = arrays.modelDescriptions;

	constructor(
		@ILanguageModelsService languageModelsService: ILanguageModelsService,
		@ILogService logService: ILogService,
	) {
		super(arrays, {
			configKey: InlineChatConfigKeys.DefaultModel,
			configSectionId: 'inlineChat',
			logPrefix: '[InlineChatDefaultModel]',
			filter: metadata => !!metadata.capabilities?.toolCalling,
		}, languageModelsService, logService);
	}
}
