/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, suite, test } from 'vitest';
import { URI } from '../../../../../util/vs/base/common/uri';
import { AdoRepoId, GithubRepoId, getOrderedRepoInfosFromContext, RepoContext } from '../../../../../platform/git/common/gitService';

suite('RepoContext Helper Functions', () => {
	test('getOrderedRepoInfosFromContext should work with GitHub repos', () => {
		const mockRepoContext: RepoContext = {
			rootUri: URI.file('/test/repo'),
			headBranchName: 'feature-branch',
			headCommitHash: 'abc123',
			upstreamBranchName: 'main',
			upstreamRemote: 'origin',
			isRebasing: false,
			remotes: ['origin'],
			remoteFetchUrls: ['https://github.com/owner/repo.git'],
			changes: undefined,
			headBranchNameObs: {} as any,
			headCommitHashObs: {} as any,
			upstreamBranchNameObs: {} as any,
			upstreamRemoteObs: {} as any,
			isRebasingObs: {} as any,
			isIgnored: async () => false
		};

		const repoInfos = Array.from(getOrderedRepoInfosFromContext(mockRepoContext));
		expect(repoInfos).toHaveLength(1);
		expect(repoInfos[0].repoId).toBeInstanceOf(GithubRepoId);
		expect(repoInfos[0].repoId.type).toBe('github');
		expect((repoInfos[0].repoId as GithubRepoId).org).toBe('owner');
		expect((repoInfos[0].repoId as GithubRepoId).repo).toBe('repo');
	});

	test('getOrderedRepoInfosFromContext should work with Azure DevOps repos', () => {
		const mockRepoContext: RepoContext = {
			rootUri: URI.file('/test/repo'),
			headBranchName: 'feature-branch',
			headCommitHash: 'abc123',
			upstreamBranchName: 'main',
			upstreamRemote: 'origin',
			isRebasing: false,
			remotes: ['origin'],
			remoteFetchUrls: ['https://dev.azure.com/myorg/myproject/_git/myrepo'],
			changes: undefined,
			headBranchNameObs: {} as any,
			headCommitHashObs: {} as any,
			upstreamBranchNameObs: {} as any,
			upstreamRemoteObs: {} as any,
			isRebasingObs: {} as any,
			isIgnored: async () => false
		};

		const repoInfos = Array.from(getOrderedRepoInfosFromContext(mockRepoContext));
		expect(repoInfos).toHaveLength(1);
		expect(repoInfos[0].repoId).toBeInstanceOf(AdoRepoId);
		expect(repoInfos[0].repoId.type).toBe('ado');
		expect((repoInfos[0].repoId as AdoRepoId).org).toBe('myorg');
		expect((repoInfos[0].repoId as AdoRepoId).project).toBe('myproject');
		expect((repoInfos[0].repoId as AdoRepoId).repo).toBe('myrepo');
	});

	test('getOrderedRepoInfosFromContext should return empty for unknown repo types', () => {
		const mockRepoContext: RepoContext = {
			rootUri: URI.file('/test/repo'),
			headBranchName: 'feature-branch',
			headCommitHash: 'abc123',
			upstreamBranchName: 'main',
			upstreamRemote: 'origin',
			isRebasing: false,
			remotes: ['origin'],
			remoteFetchUrls: ['https://gitlab.com/owner/repo.git'],
			changes: undefined,
			headBranchNameObs: {} as any,
			headCommitHashObs: {} as any,
			upstreamBranchNameObs: {} as any,
			upstreamRemoteObs: {} as any,
			isRebasingObs: {} as any,
			isIgnored: async () => false
		};

		const repoInfos = Array.from(getOrderedRepoInfosFromContext(mockRepoContext));
		expect(repoInfos).toHaveLength(0);
	});

	test('getOrderedRepoInfosFromContext should handle no remote URLs', () => {
		const mockRepoContext: RepoContext = {
			rootUri: URI.file('/test/repo'),
			headBranchName: 'feature-branch',
			headCommitHash: 'abc123',
			upstreamBranchName: 'main',
			upstreamRemote: 'origin',
			isRebasing: false,
			remotes: [],
			remoteFetchUrls: [],
			changes: undefined,
			headBranchNameObs: {} as any,
			headCommitHashObs: {} as any,
			upstreamBranchNameObs: {} as any,
			upstreamRemoteObs: {} as any,
			isRebasingObs: {} as any,
			isIgnored: async () => false
		};

		const repoInfos = Array.from(getOrderedRepoInfosFromContext(mockRepoContext));
		expect(repoInfos).toHaveLength(0);
	});
});