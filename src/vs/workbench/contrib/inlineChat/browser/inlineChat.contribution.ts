/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IInlineChatSessionService } from './inlineChatSessionService.js';
import { InlineChatSessionServiceImpl } from './inlineChatSessionServiceImpl.js';
import { IInlineChatSessionResolver, InlineChatSessionResolver } from './inlineChatSessionResolver.js';

// registerEditorContribution(InlineChatController.ID, InlineChatController, EditorContributionInstantiation.Eager); // EAGER because of notebook dispose/create of editors

// registerAction2(InlineChatActions.KeepSessionAction2);
// registerAction2(InlineChatActions.UndoAndCloseSessionAction2);
// registerAction2(InlineChatActions.CancelSessionAction);
// registerAction2(InlineChatActions.ContinueInlineChatInChatViewAction);
// registerAction2(InlineChatActions.RephraseInlineChatSessionAction);

// --- browser

registerSingleton(IInlineChatSessionService, InlineChatSessionServiceImpl, InstantiationType.Delayed);
registerSingleton(IInlineChatSessionResolver, InlineChatSessionResolver, InstantiationType.Delayed);

// --- actions ---

// registerAction2(InlineChatActions.StartSessionAction);
// registerAction2(InlineChatActions.AskInChatAction);
// registerAction2(InlineChatActions.FocusInlineChat);
// registerAction2(InlineChatActions.FixDiagnosticsAction);
// registerAction2(InlineChatActions.DismissEditorAffordanceAction);

// --- contribs ---
// registerWorkbenchContribution2('inlineChat.notebooks', InlineChatNotebookContribution, WorkbenchPhase.AfterRestored);
// registerWorkbenchContribution2(InlineChatDefaultModel.ID, InlineChatDefaultModel, WorkbenchPhase.BlockRestore);
// registerWorkbenchContribution2(InlineChatEnabler.Id, InlineChatEnabler, WorkbenchPhase.AfterRestored);
// registerWorkbenchContribution2(InlineChatEscapeToolContribution.Id, InlineChatEscapeToolContribution, WorkbenchPhase.AfterRestored);

// AccessibleViewRegistry.register(new InlineChatAccessibilityHelp());
