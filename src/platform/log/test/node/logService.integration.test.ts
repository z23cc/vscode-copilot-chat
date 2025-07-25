/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { LogLevel, LogServiceImpl, ILogService, ILogTarget } from '../../common/logService';

// Mock dependencies
const mockSimulationTestContext = {} as any;
const mockVSCodeExtensionContext = {} as any;

class MockLogTarget implements ILogTarget {
	public messages: Array<{ level: LogLevel; message: string }> = [];

	logIt(level: LogLevel, message: string): void {
		this.messages.push({ level, message });
	}

	show?(preserveFocus?: boolean): void {
		// No-op for testing
	}
}

describe('LogService Integration', () => {
	let mockTarget: MockLogTarget;
	let logService: ILogService;

	beforeEach(() => {
		mockTarget = new MockLogTarget();
		logService = new LogServiceImpl([mockTarget], mockSimulationTestContext, mockVSCodeExtensionContext);
	});

	test('should demonstrate the simplified API in practice', () => {
		// Before: logService.logger.info('message')
		// After: logService.info('message')
		
		// Test typical usage patterns
		logService.debug('Debug: Starting operation');
		logService.info('Info: Operation in progress');
		logService.warn('Warning: Something needs attention');
		logService.error('Error: Something went wrong');
		
		// Verify all messages were logged
		expect(mockTarget.messages).toHaveLength(4);
		expect(mockTarget.messages[0]).toEqual({ level: LogLevel.Debug, message: 'Debug: Starting operation' });
		expect(mockTarget.messages[1]).toEqual({ level: LogLevel.Info, message: 'Info: Operation in progress' });
		expect(mockTarget.messages[2]).toEqual({ level: LogLevel.Warning, message: 'Warning: Something needs attention' });
		expect(mockTarget.messages[3]).toEqual({ level: LogLevel.Error, message: 'Error: Something went wrong' });
	});

	test('should support error logging with context', () => {
		const error = new Error('Network timeout');
		logService.error(error, 'Failed to fetch data');
		
		expect(mockTarget.messages).toHaveLength(1);
		expect(mockTarget.messages[0].level).toBe(LogLevel.Error);
		expect(mockTarget.messages[0].message).toContain('Network timeout');
		expect(mockTarget.messages[0].message).toContain('Failed to fetch data');
	});

	test('should maintain backward compatibility', () => {
		// The old way should still work
		logService.logger.info('Old API still works');
		
		expect(mockTarget.messages).toHaveLength(1);
		expect(mockTarget.messages[0]).toEqual({ level: LogLevel.Info, message: 'Old API still works' });
	});

	test('should support show methods', () => {
		// These should not throw
		expect(() => logService.show()).not.toThrow();
		expect(() => logService.showPublicLog()).not.toThrow();
		expect(() => logService.logger.show()).not.toThrow();
	});
});