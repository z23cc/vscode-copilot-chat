/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../util/vs/base/common/lifecycle';
import { DiagnosticData } from '../dataTypes/diagnosticData';
import { DocumentId } from '../dataTypes/documentId';
import { ObservableWorkspace } from '../observableWorkspace';
import { IXtabHistoryEntry, NesXtabHistoryTracker } from './nesXtabHistoryTracker';

export interface IXtabContext {
	history: IXtabHistoryEntry[];
	diagnostics: DiagnosticData[];
}

export class NesXtabContextTracker extends Disposable {

	/** Max # of Diagnostics added to context */
	private static MAX_N_DIAGNOSTICS = 10;

	private readonly historyTracker: NesXtabHistoryTracker;

	constructor(
		private readonly workspace: ObservableWorkspace,
		maxHistorySize?: number,
		private readonly maxNDiagnostics: number = NesXtabContextTracker.MAX_N_DIAGNOSTICS
	) {
		super();
		this.historyTracker = new NesXtabHistoryTracker(workspace, maxHistorySize);
	}

	public getContext(doc: DocumentId): IXtabContext {
		return {
			history: this.historyTracker.getHistory(),
			diagnostics: this.getDiagnostics(doc),
		};
	}

	private getDiagnostics(doc: DocumentId): DiagnosticData[] {
		const observableDoc = this.workspace.getDocument(doc);
		if (!observableDoc) {
			return [];
		}
		return observableDoc.diagnostics.get().slice(0, this.maxNDiagnostics);
	}
}
