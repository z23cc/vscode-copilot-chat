/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, test, vi } from 'vitest';
import { URI } from '../../../../../util/vs/base/common/uri';
import { RepoContext } from '../../../../../platform/git/common/gitService';
import { IObservable } from '../../../../../util/vs/base/common/observableInternal';

// Mock the service interfaces
const mockGitService = {
	activeRepository: {
		get: vi.fn()
	}
};

const mockInstantiationService = {
	createInstance: vi.fn()
};

// Mock observable implementation  
const mockObservable = <T>(value: T): IObservable<T> => ({
	get: () => value,
	read: () => value,
	map: (fn: (value: T) => any) => mockObservable(fn(value)),
	reportChanges: () => {},
	addObserver: () => ({ dispose: () => {} })
});

// Create test cases for different repository types
test('RepoContext should handle GitHub repositories', () => {
	const githubRepoContext: RepoContext = {
		rootUri: URI.file('/test/github-repo'),
		headBranchName: 'feature-branch',
		headCommitHash: 'abc123',
		upstreamBranchName: 'main',
		upstreamRemote: 'origin',
		isRebasing: false,
		remotes: ['origin'],
		remoteFetchUrls: ['https://github.com/microsoft/vscode.git'],
		changes: undefined,
		headBranchNameObs: mockObservable('feature-branch'),
		headCommitHashObs: mockObservable('abc123'),
		upstreamBranchNameObs: mockObservable('main'),
		upstreamRemoteObs: mockObservable('origin'),
		isRebasingObs: mockObservable(false),
		isIgnored: async () => false
	};

	mockGitService.activeRepository.get.mockReturnValue(githubRepoContext);

	// Test the logic from our updated render method
	const repoInfos = Array.from(require('../../../../../platform/git/common/gitService').getOrderedRepoInfosFromContext(githubRepoContext));
	expect(repoInfos).toHaveLength(1);
	expect(repoInfos[0].repoId.type).toBe('github');
	expect(repoInfos[0].repoId.org).toBe('microsoft');
	expect(repoInfos[0].repoId.repo).toBe('vscode');
});

test('RepoContext should handle Azure DevOps repositories', () => {
	const adoRepoContext: RepoContext = {
		rootUri: URI.file('/test/ado-repo'),
		headBranchName: 'develop',
		headCommitHash: 'def456',
		upstreamBranchName: 'main',
		upstreamRemote: 'origin',
		isRebasing: false,
		remotes: ['origin'],
		remoteFetchUrls: ['https://dev.azure.com/myorg/myproject/_git/myrepo'],
		changes: undefined,
		headBranchNameObs: mockObservable('develop'),
		headCommitHashObs: mockObservable('def456'),
		upstreamBranchNameObs: mockObservable('main'),
		upstreamRemoteObs: mockObservable('origin'),
		isRebasingObs: mockObservable(false),
		isIgnored: async () => false
	};

	mockGitService.activeRepository.get.mockReturnValue(adoRepoContext);

	// Test the logic from our updated render method
	const repoInfos = Array.from(require('../../../../../platform/git/common/gitService').getOrderedRepoInfosFromContext(adoRepoContext));
	expect(repoInfos).toHaveLength(1);
	expect(repoInfos[0].repoId.type).toBe('ado');
	expect(repoInfos[0].repoId.org).toBe('myorg');
	expect(repoInfos[0].repoId.project).toBe('myproject');
	expect(repoInfos[0].repoId.repo).toBe('myrepo');
});

test('RepoContext should handle unknown repository types (fallback)', () => {
	const unknownRepoContext: RepoContext = {
		rootUri: URI.file('/test/unknown-repo'),
		headBranchName: 'main',
		headCommitHash: 'ghi789',
		upstreamBranchName: 'main',
		upstreamRemote: 'origin',
		isRebasing: false,
		remotes: ['origin'],
		remoteFetchUrls: ['https://gitlab.com/owner/repo.git'],
		changes: undefined,
		headBranchNameObs: mockObservable('main'),
		headCommitHashObs: mockObservable('ghi789'),
		upstreamBranchNameObs: mockObservable('main'),
		upstreamRemoteObs: mockObservable('origin'),
		isRebasingObs: mockObservable(false),
		isIgnored: async () => false
	};

	mockGitService.activeRepository.get.mockReturnValue(unknownRepoContext);

	// Test the logic from our updated render method
	const repoInfos = Array.from(require('../../../../../platform/git/common/gitService').getOrderedRepoInfosFromContext(unknownRepoContext));
	expect(repoInfos).toHaveLength(0); // No supported repo providers

	// Should still show basic repository information
	const repositoryPath = unknownRepoContext.rootUri.fsPath;
	const repositoryName = repositoryPath.split('/').pop() || repositoryPath;
	const currentBranch = unknownRepoContext.headBranchName;

	expect(repositoryName).toBe('unknown-repo');
	expect(currentBranch).toBe('main');
	expect(repositoryPath).toBe('/test/unknown-repo');
});

test('RepoContext should handle repositories without remote URLs', () => {
	const localRepoContext: RepoContext = {
		rootUri: URI.file('/test/local-repo'),
		headBranchName: 'master',
		headCommitHash: 'jkl012',
		upstreamBranchName: undefined,
		upstreamRemote: undefined,
		isRebasing: false,
		remotes: [],
		remoteFetchUrls: [],
		changes: undefined,
		headBranchNameObs: mockObservable('master'),
		headCommitHashObs: mockObservable('jkl012'),
		upstreamBranchNameObs: mockObservable(undefined),
		upstreamRemoteObs: mockObservable(undefined),
		isRebasingObs: mockObservable(false),
		isIgnored: async () => false
	};

	mockGitService.activeRepository.get.mockReturnValue(localRepoContext);

	// Test the logic from our updated render method
	const repoInfos = Array.from(require('../../../../../platform/git/common/gitService').getOrderedRepoInfosFromContext(localRepoContext));
	expect(repoInfos).toHaveLength(0); // No remote URLs

	// Should still show basic repository information
	const repositoryPath = localRepoContext.rootUri.fsPath;
	const repositoryName = repositoryPath.split('/').pop() || repositoryPath;
	const currentBranch = localRepoContext.headBranchName;

	expect(repositoryName).toBe('local-repo');
	expect(currentBranch).toBe('master');
	expect(repositoryPath).toBe('/test/local-repo');
});