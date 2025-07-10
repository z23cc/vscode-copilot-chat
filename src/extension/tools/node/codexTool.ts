/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { LanguageModelToolResult, PreparedTerminalToolInvocation } from '../../../vscodeTypes';
import { ToolName } from '../common/toolNames';
import { ICopilotTool, ToolRegistry } from '../common/toolsRegistry';
import { ReadFileParams } from './readFileTool';

export class CodexTool implements ICopilotTool<ReadFileParams> {
	public static toolName = ToolName.CodexTool;

	constructor() { }

	async invoke(options: vscode.LanguageModelToolInvocationOptions<any>, token: vscode.CancellationToken) {
		return new LanguageModelToolResult([]);
	}

	prepareInvocation2(options: vscode.LanguageModelToolInvocationPrepareOptions<any>, token: vscode.CancellationToken): vscode.ProviderResult<vscode.PreparedTerminalToolInvocation> {
		return new PreparedTerminalToolInvocation(options.input.detail,
			'sh',
			{
				title: options.input.message,
				message: ''
			}
		);
	}
}

ToolRegistry.registerTool(CodexTool);
