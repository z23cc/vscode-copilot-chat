/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { StringEdit } from '../../../util/vs/editor/common/core/edits/stringEdit';
import * as vscodeTypes from '../../../vscodeTypes';
import { IDiffService } from '../../diff/common/diffService';
import { stringEditFromDiff } from '../../editing/common/edit';
import { OffsetBasedTextDocument } from '../../editing/common/offsetBasedTextDocument';

export interface IEditCollector {
	initialText: string;
	addEdits(edits: vscodeTypes.TextEdit[]): void;
	getText(): string;
	getEdits(): Promise<StringEdit>;
}

export class EditCollector implements IEditCollector {
	private readonly _document: OffsetBasedTextDocument;

	constructor(
		public readonly initialText: string,
		@IDiffService private readonly _diffService: IDiffService,
	) {
		this._document = new OffsetBasedTextDocument(initialText);
	}

	public addEdits(edits: vscodeTypes.TextEdit[]): void {
		this._document.applyTextEdits(edits);
	}

	public getText(): string {
		return this._document.getValue();
	}

	public async getEdits(): Promise<StringEdit> {
		const newText = this.getText();
		const edits = await stringEditFromDiff(this.initialText, newText, this._diffService);
		return edits;
	}
}
