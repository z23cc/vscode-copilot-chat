/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { LogLevel, LogServiceImpl } from '../../common/logService';
import { TestLogTarget } from './loggerHelpers';

// Mock dependencies
const mockSimulationTestContext = {} as any;
const mockVSCodeExtensionContext = {} as any;

describe('LogService', () => {
	let logTarget: TestLogTarget;
	let logService: LogServiceImpl;

	beforeEach(() => {
		logTarget = new TestLogTarget();
		logService = new LogServiceImpl([logTarget], mockSimulationTestContext, mockVSCodeExtensionContext);
	});

	test('should support direct logging methods on logService', () => {
		// Test the new simplified API
		logService.trace('trace message');
		logService.debug('debug message');
		logService.info('info message');
		logService.warn('warn message');
		logService.error('error message');

		// Verify messages were logged
		logTarget.assertHasMessage(LogLevel.Trace, 'trace message');
		logTarget.assertHasMessage(LogLevel.Debug, 'debug message');
		logTarget.assertHasMessage(LogLevel.Info, 'info message');
		logTarget.assertHasMessage(LogLevel.Warning, 'warn message');
		logTarget.assertHasMessage(LogLevel.Error, 'error message');
	});

	test('should maintain backward compatibility with logger property', () => {
		// Test that the old API still works
		logService.trace('trace via logger');
		logService.debug('debug via logger');
		logService.info('info via logger');
		logService.warn('warn via logger');
		logService.error('error via logger');

		// Verify messages were logged
		logTarget.assertHasMessage(LogLevel.Trace, 'trace via logger');
		logTarget.assertHasMessage(LogLevel.Debug, 'debug via logger');
		logTarget.assertHasMessage(LogLevel.Info, 'info via logger');
		logTarget.assertHasMessage(LogLevel.Warning, 'warn via logger');
		logTarget.assertHasMessage(LogLevel.Error, 'error via logger');
	});

	test('should handle error objects correctly', () => {
		const error = new Error('test error');
		logService.error(error, 'context message');
		
		// Should have logged the error with context
		expect(logTarget.hasMessageMatching(LogLevel.Error, /test error.*context message/)).toBe(true);
	});

	test('should support show methods', () => {
		// These should not throw
		logService.show();
		logService.show();
		logService.show();
	});
});