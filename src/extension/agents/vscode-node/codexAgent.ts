/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { DeferredPromise } from '../../../util/vs/base/common/async';
import { Event } from '../../../util/vs/base/common/event';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { CodexClient } from './proto';
import { IToolsService } from '../../tools/common/toolsService';
import { ToolName } from '../../tools/common/toolNames';
import { ILogService } from '../../../platform/log/common/logService';

export class CodexAgentManager {
	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IToolsService private readonly toolsService: IToolsService,
		@ILogService private readonly logService: ILogService
	) { }

	public async handleRequest(request: vscode.ChatRequest, context: vscode.ChatContext, progress: vscode.ChatResponseStream, token: vscode.CancellationToken): Promise<vscode.ChatResult> {
		const codexClient = this.instantiationService.createInstance(CodexClient);
		const responseDoneDeferred = new DeferredPromise();

		try {
			// Set up event handling
			const eventListener = codexClient.onEvent(async event => {
				const eventMsg = event.msg;
				switch (eventMsg.type) {
					case 'agent_message':
						progress.markdown(eventMsg.message);
						break;
					case 'error':
						progress.markdown(`❌ **Error:** ${eventMsg.message}`);
						break;
					case 'task_started':
						// progress.markdown('🚀 **Task started**');
						break;
					case 'task_complete': {
						// const completedMsg = eventMsg.last_agent_message
						// 	? `✅ **Task completed:** ${eventMsg.last_agent_message}`
						// 	: '✅ **Task completed**';
						// progress.markdown(completedMsg);
						responseDoneDeferred.complete(undefined);
						break;
					}
					case 'token_count':
						// progress.markdown(`📊 **Tokens:** ${eventMsg.total_tokens} total (${eventMsg.input_tokens} input, ${eventMsg.output_tokens} output)`);
						break;
					case 'agent_reasoning':
						progress.markdown(`🧠 **Reasoning:** ${eventMsg.text}`);
						break;
					case 'session_configured':
						// progress.markdown(`⚙️ **Session configured** with model: ${event.model}`);
						break;
					case 'exec_approval_request': {
						const commandStr = eventMsg.command.join(' ');
						// progress.markdown(`⚠️ **Approval needed for command:** \`${commandStr}\``);

						let gotApproval;
						try {
							await this.toolsService.invokeTool(ToolName.CodexTool, { input: { message: 'Run command?', detail: commandStr }, toolInvocationToken: request.toolInvocationToken }, token);
							gotApproval = true;
						} catch (error) {
							this.logService.logger.error(error, 'Codex command approval failed');
							gotApproval = false;
						}
						codexClient.sendExecApproval(gotApproval ? 'approved' : 'denied', event.id);

						break;
					}
					case 'apply_patch_approval_request': {
						const fileCount = Object.keys(eventMsg.changes).length;
						progress.markdown(`📝 **Giving approval for patch:** ${fileCount} file(s) to modify`);
						// Auto-approve for demo purposes
						codexClient.sendPatchApproval('approved', event.id);
						break;
					}
					case 'exec_command_begin': {
						const cmd = eventMsg.command.join(' ');
						progress.markdown(`⚡ **Executing:** \`${cmd}\``);
						break;
					}
					case 'exec_command_end':
						if (eventMsg.exit_code === 0) {
							// progress.markdown('✅ **Command completed successfully**');
						} else {
							// progress.markdown(`❌ **Command failed** (exit code: ${eventMsg.exit_code})`);
						}
						break;
					case 'patch_apply_begin': {
						const changeCount = Object.keys(eventMsg.changes).length;
						progress.markdown(`🔄 **Applying patch** to ${changeCount} file(s)...`);
						break;
					}
					case 'patch_apply_end':
						if (eventMsg.success) {
							progress.markdown('✅ **Patch applied successfully**');
						} else {
							progress.markdown('❌ **Patch failed to apply**');
						}
						break;
					default:
						// Handle any other event types
						progress.markdown(`📢 **Event:** ${JSON.stringify(eventMsg)}`);
						break;
				}
				progress.markdown('\n\n');
			});

			// Clean up event listener when request is cancelled
			token.onCancellationRequested(() => {
				eventListener.dispose();
			});

			const configuredP = Event.toPromise(Event.filter(codexClient.onEvent, e => e.msg.type === 'session_configured'));

			// Start Codex if not already started
			await codexClient.start('/Users/roblou/code/vscode-copilot2');
			await configuredP;

			// Send the user's message to Codex
			await codexClient.sendUserInput(request.prompt);

			await responseDoneDeferred.p;
			return {};
		} catch (error) {
			progress.markdown(`❌ **Failed to start Codex:** ${error}`);
			return {};
		}
	}
}