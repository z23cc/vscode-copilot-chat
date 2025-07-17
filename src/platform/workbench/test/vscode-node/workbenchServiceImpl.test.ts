/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { WorkbenchServiceImpl } from '../../vscode/workbenchServiceImpt';

suite('HostServiceImpl', () => {
	test('getAllCommands', async () => {
		const envService = new WorkbenchServiceImpl();
		const commands = await envService.getAllCommands();
		assert.ok(Array.isArray(commands));
		assert.ok(commands.length > 0);
		assert.ok(commands[0].label);
		assert.ok(commands[0].command);
		assert.ok(commands[0].keybinding);
	}).timeout(10000); // Give this test a little bit more time due to potential delays in fetching commands

	test('getAllSettings', async () => {
		const envService = new WorkbenchServiceImpl();
		const settings = await envService.getAllSettings();
		assert.ok(typeof settings === 'object');
		assert.ok(Object.keys(settings).length > 0);
	});
});
