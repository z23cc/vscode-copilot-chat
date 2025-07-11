/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { strictEqual } from 'assert';
import { NullTerminalService } from '../../../../platform/terminal/common/terminalService';
import { GetAllTerminalsTool, GetTerminalLastCommandTool, GetTerminalSelectionTool } from '../terminalStateTools';

suite('Terminal State Tools', () => {
	test('GetAllTerminalsTool should return no terminals message when no terminals are open', async () => {
		const terminalService = new NullTerminalService();
		const tool = new GetAllTerminalsTool(terminalService);
		
		const result = await tool.invoke({
			input: undefined,
			invocationToken: '',
			requestId: '',
			tokenBudget: {}
		}, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => {} }) } as any);
		
		strictEqual(result.content.length, 1);
		strictEqual(result.content[0].type, 'text');
		strictEqual((result.content[0] as any).value, 'No terminals are currently open.');
	});

	test('GetTerminalSelectionTool should return no selection message when no text is selected', async () => {
		const terminalService = new NullTerminalService();
		const tool = new GetTerminalSelectionTool(terminalService);
		
		const result = await tool.invoke({
			input: undefined,
			invocationToken: '',
			requestId: '',
			tokenBudget: {}
		}, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => {} }) } as any);
		
		strictEqual(result.content.length, 1);
		strictEqual(result.content[0].type, 'text');
		strictEqual((result.content[0] as any).value, 'No text is currently selected in the active terminal.');
	});

	test('GetTerminalLastCommandTool should return no command message when no command has been run', async () => {
		const terminalService = new NullTerminalService();
		const tool = new GetTerminalLastCommandTool(terminalService);
		
		const result = await tool.invoke({
			input: undefined,
			invocationToken: '',
			requestId: '',
			tokenBudget: {}
		}, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => {} }) } as any);
		
		strictEqual(result.content.length, 1);
		strictEqual(result.content[0].type, 'text');
		strictEqual((result.content[0] as any).value, 'No command has been run in the active terminal.');
	});
});