
import * as fs from 'fs';
import * as path from 'path';
import * as cp from 'child_process';

import * as vscode from 'vscode';
import { LoggingDebugSession } from 'vscode-debugadapter';

export const PYTHON = 'python';
export const deepDebuggerPrefix = '--deep-debugger-';
export const deepDebuggerLogFileSwitch = deepDebuggerPrefix + 'log-file';
export const deepDebuggerSessionNameSwitch = deepDebuggerPrefix + 'session-name';
export const deepDebuggerSessionCwdSwitch = deepDebuggerPrefix + 'session-cwd';

var extensionContext: vscode.ExtensionContext;

export function getExtensionPath(internalPath: string = '') {
	return extensionContext.asAbsolutePath(internalPath);
}
export function setExtensionContext(context: vscode.ExtensionContext) {
	extensionContext = context;
}

function sleep(ms) {
	return new Promise((resolve) => {
	  setTimeout(resolve, ms);
	});
}

export async function getLock(fname: string) {
	while (true) {
		try {
			fs.mkdirSync(fname + '.lock', { recursive: true });
			break;
		}
		catch (e) {
			await sleep(5);
		}
	}
}

export function releaseLock(fname: string) {
	try {
		fs.rmdirSync(fname + '.lock');
	}
	catch (e) {
		// do nothing
	}
}

export class IPlatform {
	exeSuffix: string = '';
	pipePrefix: string = '';
	envSetCommand: string = '';
	listSeparator: string = '';
	public isNode(f) { return false; };
	public makeExecutable(fpath) { return path.join(getExtensionPath(), fpath + this.exeSuffix); }
	public setBinaryConfigType(cfg) {}
	public setConfigType(cfg) {}
	public quote(s: string) { return s; }
}

export class PlatformWin32 extends IPlatform {
	public constructor() {
		super();
		this.exeSuffix = '.exe';
		this.pipePrefix = '\\\\?\\pipe\\';
		this.envSetCommand = 'set';
		this.listSeparator = ';';
	}
	public isNode(f) { return f.toLowerCase() === 'node.exe'; };
	public setBinaryConfigType(cfg) {
		cfg.type = 'cppvsdbg';
	}
	public setConfigType(cfg) {
		switch (path.extname(cfg.program).toLowerCase()) {
			case '.exe':
				cfg.type = 'binary';
				break;
			case '.sh':
				cfg.type = 'bashdb';
				break;
		}
	}
}

export class Platform extends IPlatform {
	public constructor() {
		super();
		this.exeSuffix = '.sh';
		this.envSetCommand = 'export';
		this.listSeparator = ':';
	}
	public isNode(f) {
		 return f === 'node';
	};
	public makeExecutable(fpath) {
		fpath = super.makeExecutable(fpath);
		try {
			fs.accessSync(fpath, fs.constants.X_OK);
		} catch (e) {
			var stats = fs.statSync(fpath);
			fs.chmodSync(fpath, stats.mode | 0o111);
		}
		return fpath;
	};
	public setBinaryConfigType(cfg) {
		cfg.type = 'cppdbg';
		cfg.MIMode = 'gdb';
		cfg.setupCommands = [
			{
				description: 'Enable pretty-printing for gdb',
				text: '-enable-pretty-printing',
				ignoreFailures: true
			}
		];
	}
	public setConfigType(cfg) {
		var result = cp.execSync('file -b ' + cfg.program).toString().split(', ')[0];
		switch (result) {
			case 'ELF 64-bit LSB shared object':
				cfg.type = 'binary';
				break;
			case 'POSIX shell script':
			case 'Bourne-Again shell script':
				cfg.type = 'bashdb';
				break;
		}
	}
	public quote(s: string) {
		if (!s || s.search(/[^\w@%+=:,./-]/) < 0) {
			return s;
		}
	
		return '"' + s.replace('"', '\\"') + '"';
	}
}

export class DeepDebugSessionBase extends LoggingDebugSession {
	public platform: IPlatform;

    public constructor() {
		super('deep-debugger.txt');

		if (process.platform === 'win32') {
			this.platform = new PlatformWin32();
		} else {
			this.platform = new Platform();
		}
    }

    public decodeEnvironment(cfg) {
    }
};
