/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CharCode } from '../../../util/vs/base/common/charCode';
import { OffsetLineColumnConverter } from './offsetLineColumnConverter';
import { Position, TextEdit } from '../../../vscodeTypes';
import { StringEdit, StringReplacement } from '../../../util/vs/editor/common/core/edits/stringEdit';
import { OffsetRange } from '../../../util/vs/editor/common/core/ranges/offsetRange';
import { PositionOffsetTransformer } from './positionOffsetTransformer';

export class OffsetBasedTextDocument {
	private _converter: PositionOffsetTransformer | undefined = undefined;
	private _value: string = '';
	constructor(initialValue: string = '') {
		this._value = initialValue;
	}

	getValue(): string {
		return this._value;
	}

	applyTextEdits(edits: TextEdit[]) {
		const offsetEdit = new StringEdit(edits.map(e => {
			const start = this.positionToOffset(e.range.start);
			const end = this.positionToOffset(e.range.end);
			return new StringReplacement(new OffsetRange(start, end), e.newText);
		}));
		this.applyOffsetEdit(offsetEdit);
	}

	applyOffsetEdit(edit: StringEdit): void {
		this._value = edit.apply(this._value);
		this._converter = undefined;
	}

	positionToOffset(position: Position): number {
		if (!this._converter) {
			this._converter = new PositionOffsetTransformer(this._value);
		}
		return this._converter.getOffset(position);
	}

	offsetToPosition(offset: number): Position {
		if (!this._converter) {
			this._converter = new PositionOffsetTransformer(this._value);
		}
		return this._converter.getPosition(offset);
	}
}
