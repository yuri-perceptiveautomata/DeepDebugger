/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import { EventEmitter } from 'events';
import * as vscode from 'vscode';

export interface FileAccessor {
	readFile(path: string): Promise<string>;
}

class Term {
	static termName: string = 'Deep Debugger'; // eslint-disable-line no-undef
	static term: vscode.Terminal; // eslint-disable-line no-undef
  
	static _term() {
	  if (!Term.term) {
		Term.term = vscode.window.createTerminal(Term.termName);
		Term.term.show(true);
  
		// if user closes the terminal, delete our reference:
		vscode.window.onDidCloseTerminal(event => {
		  if (Term.term && event.name === Term.termName) {
			Term.dispose();
		  }
		});
	  }
	  return Term.term;
	}
  
	static run(command: string) {
	  console.log(`Running ${command} in ${JSON.stringify(Term._term())}`);
	  Term._term().sendText(command, true);
	}
  
	static dispose() {
	  if (Term.term) {
		Term.term.dispose();
	  }
	}
}

/**
 * A Deep runtime with minimal debugger functionality.
 */
export class DeepRuntime extends EventEmitter {

	// the initial (and one and only) file we are 'debugging'
	private _sourceFile: string = '';
	public get sourceFile() {
		return this._sourceFile;
	}

	// This is the next instruction that will be 'executed'
	public instruction= 0;

	constructor() {
		super();
	}

	protected getUserHome() {
      
		// From process.env
		return process.env[(process.platform === 'win32') ? 'USERPROFILE' : 'HOME'];
	}

	/**
	 * Start executing the given program.
	 */
	public async start(program: string): Promise<void> {
		Term.run(program);
	}
}