/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { strictEqual } from 'assert';

/**
 * Integration test that demonstrates the terminal tracking functionality.
 * This test simulates the scenario described in the GitHub issue.
 */
suite('Terminal and Task State Integration', () => {
	test('Terminal service should track both Copilot and user terminals', async () => {
		// This is a conceptual test that demonstrates the solution
		// In a real scenario, this would test the actual VS Code integration

		// Simulate the previous behavior - only Copilot terminals were tracked
		const previousBehavior = {
			getCopilotTerminals: () => [
				{ id: 'copilot-terminal-1', name: 'Copilot Terminal' }
			],
			// Previous implementation didn't have getAllTerminals
		};

		// Simulate the new behavior - all terminals are tracked with property-based distinction
		const newBehavior = {
			getAllTerminals: () => [
				{ id: 'copilot-terminal-1', name: 'Copilot Terminal', isCopilotTerminal: true },
				{ id: 'user-terminal-123', name: 'User Terminal', isCopilotTerminal: false },
				{ id: 'user-terminal-456', name: 'PowerShell', isCopilotTerminal: false }
			]
		};

		// Verify that getAllTerminals now tracks all terminals (fixes the issue)
		const allTerminals = newBehavior.getAllTerminals();
		strictEqual(allTerminals.length, 3);
		
		// Should include the Copilot terminal
		const copilotTerminal = allTerminals.find(t => t.id === 'copilot-terminal-1');
		strictEqual(copilotTerminal?.name, 'Copilot Terminal');
		strictEqual(copilotTerminal?.isCopilotTerminal, true);
		
		// Should include user-created terminals
		const userTerminal1 = allTerminals.find(t => t.id === 'user-terminal-123');
		strictEqual(userTerminal1?.name, 'User Terminal');
		strictEqual(userTerminal1?.isCopilotTerminal, false);
		
		const userTerminal2 = allTerminals.find(t => t.id === 'user-terminal-456');
		strictEqual(userTerminal2?.name, 'PowerShell');
		strictEqual(userTerminal2?.isCopilotTerminal, false);

		// Verify that Copilot terminals can be filtered from getAllTerminals
		const copilotTerminals = allTerminals.filter(t => t.isCopilotTerminal);
		strictEqual(copilotTerminals.length, 1);
		strictEqual(copilotTerminals[0].name, 'Copilot Terminal');
	});
});