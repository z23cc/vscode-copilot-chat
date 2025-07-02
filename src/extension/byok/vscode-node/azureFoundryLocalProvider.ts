/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, lm } from 'vscode';
import { IChatModelInformation } from '../../../platform/endpoint/common/endpointProvider';
import { ILogService } from '../../../platform/log/common/logService';
import { IFetcherService } from '../../../platform/networking/common/fetcherService';
import { IInstantiationService } from '../../../util/vs/platform/instantiation/common/instantiation';
import { CopilotLanguageModelWrapper } from '../../conversation/vscode-node/languageModelAccess';
import { BYOKAuthType, BYOKGlobalKeyModelConfig, BYOKModelCapabilities, BYOKModelConfig, BYOKPerModelConfig, chatModelInfoToProviderMetadata, isNoAuthConfig } from '../common/byokProvider';
import { AzureFoundryLocalEndpoint } from '../node/azureFoundryLocalEndpoint';
import { BaseOpenAICompatibleBYOKRegistry } from './baseOpenAICompatibleProvider';

/**
 * Azure Foundry Local model information from API response
 */
interface AzureFoundryLocalModel {
	vision: boolean;
	toolCalling: boolean;
	maxInputTokens: number;
	maxOutputTokens: number;
	display_name: string | null;
	id: string;
	owned_by: string;
	permission: any[];
	created: number;
	CreatedTime: string;
	root: string | null;
	parent: string | null;
	StreamEvent: any;
	IsDelta: boolean;
	Successful: boolean;
	error: any;
	HttpStatusCode: number;
	HeaderValues: any;
	object: string;
}

/**
 * Azure Foundry Local models API response structure
 */
interface AzureFoundryLocalModelsResponse {
	data: AzureFoundryLocalModel[];
	StreamEvent: any;
	IsDelta: boolean;
	Successful: boolean;
	error: any;
	HttpStatusCode: number;
	HeaderValues: any;
	object: string;
}

/**
 * Azure Foundry Local BYOK Model Registry
 *
 * Provides integration with locally running Azure Foundry Local service.
 * Models are discovered from the local API and registered for use in Copilot Chat.
 * No authentication is required as the service runs locally.
 */
export class AzureFoundryLocalBYOKModelRegistry extends BaseOpenAICompatibleBYOKRegistry {

	constructor(
		@IFetcherService private readonly _myFetcherService: IFetcherService,
		@ILogService private readonly _myLogService: ILogService,
		@IInstantiationService private readonly _myInstantiationService: IInstantiationService,
	) {
		super(
			BYOKAuthType.None,
			'Azure Foundry Local',
			'http://127.0.0.1:63008/v1',
			_myFetcherService,
			_myLogService,
			_myInstantiationService
		);
	}

	/**
	 * Fetch available models from Azure Foundry Local API
	 */
	override async getAllModels(apiKey: string): Promise<{ id: string; name: string }[]> {
		try {
			const response = await this._myFetcherService.fetch('http://127.0.0.1:63008/v1/models', {
				method: 'GET'
			});
			const data: AzureFoundryLocalModelsResponse = await response.json();

			if (data.error) {
				throw new Error(data.error);
			}

			return data.data.map((model: AzureFoundryLocalModel) => ({
				id: model.id,
				name: model.display_name || model.id
			}));
		} catch (error: any) {
			// Handle specific connection errors
			if (error.code === 'ECONNREFUSED' || error.message?.includes('ECONNREFUSED')) {
				throw new Error('Azure Foundry Local is not running. Please start the service on localhost:63008.');
			}
			if (error.message?.includes('fetch')) {
				throw new Error('Failed to connect to Azure Foundry Local. Please ensure the service is running on localhost:63008.');
			}
			// Re-throw with more context
			throw new Error(`Failed to fetch models from Azure Foundry Local: ${error.message || error}`);
		}
	}
	/**
	 * Get model information with capabilities from Azure Foundry Local API
	 */
	override async getModelInfo(modelId: string, apiKey: string, modelCapabilities?: BYOKModelCapabilities): Promise<IChatModelInformation> {
		if (!modelCapabilities) {
			const modelInfo = await this._getAzureFoundryLocalModelInformation(modelId);
			modelCapabilities = {
				name: modelInfo.display_name || modelId,
				maxOutputTokens: modelInfo.maxOutputTokens || 4096,
				maxInputTokens: modelInfo.maxInputTokens || 32768,
				vision: modelInfo.vision || false,
				toolCalling: modelInfo.toolCalling || false
			};
		}
		const chatModelInfo = await super.getModelInfo(modelId, apiKey, modelCapabilities);

		// Enable streaming for Azure Foundry Local models (required by the service)
		return {
			...chatModelInfo,
			capabilities: {
				...chatModelInfo.capabilities,
				supports: {
					...chatModelInfo.capabilities.supports,
					streaming: true // Enable streaming since Azure Foundry Local requires it
				}
			}
		};
	}

	/**
	 * Override registerModel to use custom Azure Foundry Local endpoint
	 */
	override async registerModel(config: BYOKModelConfig): Promise<Disposable> {
		const apiKey: string = isNoAuthConfig(config) ? '' : (config as BYOKPerModelConfig | BYOKGlobalKeyModelConfig).apiKey;
		try {
			const modelInfo: IChatModelInformation = await this.getModelInfo(config.modelId, apiKey, config.capabilities);

			const lmModelMetadata = chatModelInfoToProviderMetadata(modelInfo);

			const modelUrl = (config as BYOKPerModelConfig)?.deploymentUrl ?? `http://127.0.0.1:63008/v1/chat/completions`;

			// Use custom Azure Foundry Local endpoint instead of generic OpenAI endpoint
			const azureFoundryEndpoint = this._myInstantiationService.createInstance(
				AzureFoundryLocalEndpoint,
				modelInfo,
				apiKey,
				modelUrl
			);

			const provider = this._myInstantiationService.createInstance(
				CopilotLanguageModelWrapper,
				azureFoundryEndpoint,
				lmModelMetadata
			);

			const disposable = lm.registerChatModelProvider(
				`${this.name}-${config.modelId}`,
				provider,
				lmModelMetadata
			);
			return disposable;
		} catch (e) {
			this._myLogService.logger.error(`Error registering ${this.name} model ${config.modelId}`);
			throw e;
		}
	}

	/**
	 * Fetch detailed information about a specific model from Azure Foundry Local API
	 */
	private async _getAzureFoundryLocalModelInformation(modelId: string): Promise<AzureFoundryLocalModel> {
		try {
			const response = await this._myFetcherService.fetch('http://127.0.0.1:63008/v1/models', {
				method: 'GET'
			});
			const data: AzureFoundryLocalModelsResponse = await response.json();

			if (data.error) {
				throw new Error(data.error);
			}

			const model = data.data.find((m: AzureFoundryLocalModel) => m.id === modelId);
			if (!model) {
				throw new Error(`Model ${modelId} not found in Azure Foundry Local`);
			}
			return model;
		} catch (error: any) {
			// Handle specific connection errors
			if (error.code === 'ECONNREFUSED' || error.message?.includes('ECONNREFUSED')) {
				throw new Error('Azure Foundry Local is not running. Please start the service on localhost:63008.');
			}
			if (error.message?.includes('fetch')) {
				throw new Error('Failed to connect to Azure Foundry Local. Please ensure the service is running on localhost:63008.');
			}
			// Re-throw with more context if it's already our error
			if (error.message?.includes('Azure Foundry Local')) {
				throw error;
			}
			throw new Error(`Failed to get model information from Azure Foundry Local: ${error.message || error}`);
		}
	}
}