import { Subject } from 'await-notify';
import * as process from 'process';
import * as cp from 'child_process';
import * as tempName from 'temp';
import * as fs from 'fs';
import * as path from 'path';
import { randomBytes } from 'crypto';
import { DateTime } from 'luxon';

import {
	Logger, logger,
	InitializedEvent, TerminatedEvent
} from 'vscode-debugadapter';
import * as vscode from 'vscode';
import { DebugProtocol } from 'vscode-debugprotocol';

import {
	deepDebuggerPrefix,
    deepDebuggerSessionNameSwitch,
    deepDebuggerSessionCwdSwitch,
	deepDebuggerLogFileSwitch,
	DeepDebugSessionBase,
	getLock,
	releaseLock
} from './common';

import * as python from './python';

const envNameSessionId = 'DEEPDEBUGGER_SESSION_ID';
const envNameParentSessionId = 'DEEPDEBUGGER_PARENT_SESSION_ID';
const propNameSessionId = 'deepDbgSessionID';
const propNameParentSessionId = 'deepDbgParentSessionID';

const SERVER_NAME: string = 'server';

type Environment = Array<{name: string, value: string|undefined}>;

/**
 * This interface describes the deep-debugger specific launch attributes
 * (which are not part of the Debug Adapter Protocol).
 * The schema for these attributes lives in the package.json of the deep-debugger extension.
 * The interface should always match this schema.
 */
interface ILaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
	/** An absolute path to the program to debug. */
	program: string;
	/** enable logging the Debug Adapter Protocol */
	trace?: boolean;
	/** run without debugging */
	noDebug?: boolean;
}

export class DeepDebugSession extends DeepDebugSessionBase {

	private static sessionID = 0;
	private static sessionDict = new Map<string, vscode.DebugSession>();
	private useHierarchy: boolean = false;

	private static inEnc: BufferEncoding = 'base64';
	private static outEnc: BufferEncoding = 'utf8';

	private _configurationDone = new Subject();

	private server: any = undefined;

	public deepDbgSettings = vscode.workspace.getConfiguration('deepdbg');
	public logfile;
	public logLock;

	/**
	 * Creates a new debug adapter that is used for one debug session.
	 * We configure the default implementation of a debug adapter here.
	 */
	public constructor() {
		super();

		var logfile = this.deepDbgSettings.get<string>('logfile');
		if (logfile) {
			this.logfile = path.join(tempName.dir, "DeepDebugger", logfile);
			this.logLock = this.logfile + '.lock';
			releaseLock(this.logfile); // just in case
			getLock(this.logfile);
			try {
				fs.unlinkSync(this.logfile);
			}
			catch (e) {
				//
			}
			releaseLock(this.logfile);
		}

		vscode.debug.onDidStartDebugSession(session => {
			if (session.configuration.hasOwnProperty(propNameSessionId)) {
				DeepDebugSession.sessionDict[session.configuration[propNameSessionId]] = session;
			}
		});

		vscode.debug.onDidTerminateDebugSession(session => {
			if (session.configuration.hasOwnProperty(propNameSessionId)) {
				delete DeepDebugSession.sessionDict[session.configuration[propNameSessionId]];
			}
			if (session.configuration.hasOwnProperty('deepDbgHookPipe')) {
				this.stopServer(session.configuration.deepDbgHookPipe);
				delete session.configuration.deepDbgHookPipe;
			}
		});
	}

	public log(data: string) {
		if (this.logfile) {
			getLock(this.logfile);
			var timestamp = DateTime.now().toISO().replace('T', ' ').replace(/-\d{2}:\d{2}/, '');
			var log = fs.openSync(this.logfile, 'as'); // appending, in sync mode
			fs.writeFileSync(log, '[' + timestamp + '] [DeepDebugSession] ' + data + '\n');
			fs.closeSync(log);
			releaseLock(this.logfile);
		}
	}

	protected stopServer(pipeName: string) {
		var serverExe = this.platform.makeExecutable(SERVER_NAME);
		var serverArgs = [pipeName, 'stopped'];
		if (this.logfile) {
			serverArgs = serverArgs.concat([deepDebuggerLogFileSwitch, this.logfile]);
		}
		return cp.spawnSync(serverExe, serverArgs);
	}

	protected launchServer(queue: string, arg: string|undefined = undefined) {
		var serverExe = this.platform.makeExecutable(SERVER_NAME);
		var serverArgs = [queue];
		if (this.logfile) {
			serverArgs = serverArgs.concat([deepDebuggerLogFileSwitch, this.logfile]);
		}
		return cp.spawn(serverExe, serverArgs);
	}

	protected getLaunchConfigData(name: string | object) {
		if (typeof name === 'string' && vscode.workspace.workspaceFolders) {
			let wf = vscode.workspace.workspaceFolders[0];
			const configList = vscode.workspace.getConfiguration('launch', wf.uri).configurations;
			for (var idx in configList) {
				if (configList[idx].name === name) {
					var json = JSON.stringify(configList[idx]);
					return { wf: wf, cfg: JSON.parse(json) };
				}
			}
		}
		return null;
	}

	protected setEnvAsObject(env, vars) {
		for (var v of vars) {
			env[v.name] = v.value;
		}
	}

	protected setEnvAsArray(env, vars) {
		for (var v of vars) {
			env.push(v);
		}
	}

	protected getHook(mode, block: boolean = true) {
		var hookPath = this.platform.makeExecutable('hook');
		return hookPath + ' ';
	}

	protected setConfigEnvironment(cfg, env: Environment) {
		cfg[propNameSessionId] = String(DeepDebugSession.sessionID++);
		var cfgEnv: Environment = new Array;
		this.setEnvAsArray(cfgEnv, env);

		const found = cfgEnv.find(e => e.name === envNameSessionId);
		if (found) {
			found.value = cfg[propNameSessionId];
		} else {
			cfgEnv.push({name: envNameSessionId, value: cfg[propNameSessionId]});
		}

		if (cfg.type === 'cppdbg' || cfg.type === 'cppvsdbg') {
			if (!cfg.environment) {
				cfg.environment = new Array;
			}
			this.setEnvAsArray(cfg.environment, cfgEnv);
		} else {
			if (!cfg.env) {
				cfg.env = new Object;
			}
			this.setEnvAsObject(cfg.env, cfgEnv);
			delete cfg.environment;
		}
	}

	protected setConfigType(cfg) {
		switch (path.extname(cfg.program).toLowerCase()) {
			case '.py':
				cfg.type = 'python';
				break;
			case '.js':
				cfg.type = 'node';
				break;
			default:
				return false;
		}
		return true;
	}

	public decodeEnvironment(cfg) {
		var curSessionId;
		var cfgEnv = cfg.environment.split('-').map(x => {
			var u = Buffer.from(x, DeepDebugSession.inEnc).toString(DeepDebugSession.outEnc);
			var i = u.indexOf('=');
			if (i <= 0) {
				return u;
			}
			var name = u.substring(0, i);
			var value = u.substring(i + 1);
			if (name === envNameSessionId) {
				curSessionId = value;
				value = DeepDebugSession.sessionID.toString();
				++DeepDebugSession.sessionID;
				cfg[propNameSessionId] = value;
			}
			return {name: name, value: value};
		}).filter(x => {
			return typeof x === 'object';
		});

		if (curSessionId) {
			const found = cfgEnv.find(e => e.name === envNameParentSessionId);
			if (found) {
				found.value = curSessionId;
			} else {
				cfgEnv.push({name: envNameParentSessionId, value: curSessionId});
			}
		}

		delete(cfg.environment);

		if (cfg.type === 'binary') {
			cfg.environment = cfgEnv;
		} else {
			if (!cfg.env) {
				cfg.env = new Object;
			}
			this.setEnvAsObject(cfg.env, cfgEnv);
		}

		return cfgEnv;
	}

	protected resolveCfgProgram(cfg) {
		if (!path.isAbsolute(cfg.program)) {
			cfg.program = path.join(cfg.cwd, cfg.program);
			if (!fs.existsSync(cfg.program)) {
				var dirName = path.dirname(process.argv[2]);
				if (dirName === '.') {
					var envPath = cfg.environment.find(e => e.name === 'PATH');
					if (envPath) {
						var splitPath = envPath.value.split(this.platform.listSeparator);
						for (var pathPart in splitPath) {
							var testPath = path.join(splitPath[pathPart], process.argv[2]);
							if (fs.existsSync(testPath)) {
								cfg.program = testPath;
								break;
							}
						}
					}
				}
			}
		}
	}

	protected decodeConfig(cfg) {

		cfg.cwd = Buffer.from(cfg.cwd, DeepDebugSession.inEnc).toString(DeepDebugSession.outEnc);

		var args = cfg.cmdline.split('-').map(x => {
			return this.platform.quote(Buffer.from(x, DeepDebugSession.inEnc).toString(DeepDebugSession.outEnc));
		}).filter(x => {
			return x !== '';
		});

		if (!cfg.program) {
			cfg.program = args[0];
			cfg.args = args.slice(1);
		} else {
			cfg.program = Buffer.from(cfg.program, DeepDebugSession.inEnc).toString(DeepDebugSession.outEnc);
			cfg.args = args;
		}
		delete(cfg.cmdline);

		var unquote = require('unquote');

		for (var i = 1; i < cfg.args.length; ++i) {
			if (cfg.args[i] === deepDebuggerSessionNameSwitch) {
				var name = unquote(cfg.args[++i]);
				if (name.startsWith('\\')) {
					name = name.substring(1)
				}
				cfg.name = unquote(name);
			}
			if (cfg.args[i] === deepDebuggerSessionCwdSwitch) {
				cfg.cwd = unquote(cfg.args[++i]);
			}
		}
			
		while (cfg.args.length > 1 && cfg.args[cfg.args.length - 2].startsWith(deepDebuggerPrefix)) {
			cfg.args.pop();
			cfg.args.pop();
		}

		this.resolveCfgProgram(cfg);

		if (!cfg.name) {
			cfg.name = path.basename(cfg.program);
		}

		if (cfg.type) {
			cfg.type = Buffer.from(cfg.type, DeepDebugSession.inEnc).toString(DeepDebugSession.outEnc);
		} else if (!this.setConfigType(cfg)) {
			this.platform.setConfigType(cfg);
		}

		cfg.request = 'launch';
		cfg.stopAtEntry = false;
		cfg.console = 'integratedTerminal';
	}

	protected onStart(param) {
		this.log('onStart param: ' + param);
		try {
			var cfg = JSON.parse(param);
			this.decodeConfig(cfg);
			var parentSession: vscode.DebugSession | undefined;
			if (this.useHierarchy) {
				if (cfg.hasOwnProperty(propNameParentSessionId)) {
					parentSession = DeepDebugSession.sessionDict[cfg[propNameParentSessionId]];
				}
			}
			var confirmed = true;
			switch (cfg.type) {
				case 'deepdbg-pythonBin':
					confirmed = python.transformConfig(cfg, this);
					break;
				default:
					this.decodeEnvironment(cfg);
					if (cfg.type === 'binary') {
						this.platform.setBinaryConfigType(cfg);
					}
					break;
			}
			if (confirmed) {
				this.log('onStart config: ' + JSON.stringify(cfg));
				vscode.debug.startDebugging(undefined, cfg, parentSession);
			}
		}
		catch (e) {
			//
		}
	}

	responce: string = '';

	protected onMessage(commandString: string) {
		const SPLIT_CHAR = '|';
		this.responce += commandString;
		if (!commandString.endsWith(SPLIT_CHAR + 'end')) {
			return;
		}
		var commandArray = this.responce.trim().split(SPLIT_CHAR);
		this.responce = '';
		if (commandArray.length >= 1) {
			var param = commandArray[1];
			switch (commandArray[0]) {
				case 'start':
					this.onStart(param);
					break;
			}
		}
	}

	protected launchDebugeeConfig(args: ILaunchRequestArguments) {

		const pipeName = args['messageQueueName']??('deepdbg-lque-' + randomBytes(10).toString('hex'));
		var tempLauncherQueuePath = this.platform.pipePrefix + path.join(tempName.dir, "DeepDebugger", pipeName);

		this.useHierarchy = this.deepDbgSettings.get<boolean>('debugSessionsHierarchy') ?? false;

		this.stopServer(tempLauncherQueuePath);
		this.server = this.launchServer(tempLauncherQueuePath);
		this.server.stdout.on('data', d => { this.onMessage(d.toString('latin1')); });

		try {
			var env = [
				{name: 'DEEPDEBUGGER_LAUNCHER_QUEUE', value: tempLauncherQueuePath},
				{name: args['defaultHook']??'DEEPDBG', value: this.getHook('default')},
				{name: args['pythonHook']??'DEEPDBG_PYTHON', value: this.getHook('py')},
				{name: args['cppHook']??'DEEPDBG_CPP', value: this.getHook('cpp')},
				{name: args['cppHookNoBlock']??'DEEPDBG_CPP_NB', value: this.getHook('cpp', false)},
				{name: args['bashHook']??'DEEPDBG_BASH', value: this.getHook('bash')},
				{name: args['bashHookNoBlock']??'DEEPDBG_BASH_NB', value: this.getHook('bash', false)},
				{name: args['spawnHook']??'DEEPDBG_SPAWN', value: this.getHook('spawn')},
			];
			if (this.logfile) {
				env = env.concat([{name: 'DEEPDEBUGGER_LOGFILE', value: this.logfile}]);
			}
			if (args.hasOwnProperty('environment')) {
				env = env.concat(args['environment']);
			}

			var launch = args['launch'];
			var cfgData = this.getLaunchConfigData(launch);
			if (cfgData) {
				cfgData.cfg.name = cfgData.cfg.program;
				cfgData.cfg.deepDbgHookPipe = tempLauncherQueuePath;

				if (cfgData.cfg.type === 'python' && cfgData.cfg.request === 'launch') {
					python.makeBinConfig(cfgData.cfg, cfgData.wf, this);
					if (this.logfile) {
						cfgData.cfg.args = cfgData.cfg.args.concat([deepDebuggerLogFileSwitch, this.logfile]);
					}
				}

				this.setConfigEnvironment(cfgData.cfg, env);

				this.log(JSON.stringify(cfgData));
				vscode.debug.startDebugging(cfgData.wf, cfgData.cfg);
			} else {
				// const cp = require('child_process');
				// var exec_env = process.env;
				// this.setEnvAsObject(exec_env, env);
				// cp.exec(launch, {env: exec_env});
				var terminalName = 'Deep Debugger';
				var terminal = vscode.window.terminals.find(t => t.name === terminalName);
				terminal?.dispose();
				terminal = vscode.window.createTerminal(terminalName);
				terminal.show();
				var setCmd = this.platform.envSetCommand;
				for (var v of env) {
					terminal.sendText(setCmd + ' ' + v.name + '=\'' + v.value + '\'');
				}
				terminal.sendText(launch.join(' '));
			}
		} catch (err) {
			//
		}

		this.sendEvent(new TerminatedEvent());
	}

	/**
	 * The 'initialize' request is the first request called by the frontend
	 * to interrogate the features the debug adapter provides.
	 */
	protected initializeRequest(response: DebugProtocol.InitializeResponse, args: DebugProtocol.InitializeRequestArguments): void {

		// build and return the capabilities of this debug adapter:
		response.body = response.body || {};

		// the adapter implements the configurationDone request.
		response.body.supportsConfigurationDoneRequest = true;

		// make VS Code use 'evaluate' when hovering over source
		response.body.supportsEvaluateForHovers = true;

		// make VS Code show a 'step back' button
		response.body.supportsStepBack = true;

		// make VS Code support data breakpoints
		response.body.supportsDataBreakpoints = true;

		// make VS Code support completion in REPL
		response.body.supportsCompletionsRequest = true;
		response.body.completionTriggerCharacters = [ '.', '[' ];

		// make VS Code send cancel request
		response.body.supportsCancelRequest = true;

		// make VS Code send the breakpointLocations request
		response.body.supportsBreakpointLocationsRequest = true;

		// make VS Code provide "Step in Target" functionality
		response.body.supportsStepInTargetsRequest = true;

		// the adapter defines two exceptions filters, one with support for conditions.
		response.body.supportsExceptionFilterOptions = true;
		response.body.exceptionBreakpointFilters = [
			{
				filter: 'namedException',
				label: 'Named Exception',
				description: `Break on named exceptions. Enter the exception's name as the Condition.`,
				default: false,
				supportsCondition: true,
				conditionDescription: `Enter the exception's name`
			},
			{
				filter: 'otherExceptions',
				label: 'Other Exceptions',
				description: 'This is a other exception',
				default: true,
				supportsCondition: false
			}
		];

		// make VS Code send exceptionInfo request
		response.body.supportsExceptionInfoRequest = true;

		// make VS Code send setVariable request
		response.body.supportsSetVariable = false;

		// make VS Code send setExpression request
		response.body.supportsSetExpression = true;

		// make VS Code send disassemble request
		response.body.supportsDisassembleRequest = true;
		response.body.supportsSteppingGranularity = true;
		response.body.supportsInstructionBreakpoints = true;

		this.sendResponse(response);

		// since this debug adapter can accept configuration requests like 'setBreakpoint' at any time,
		// we request them early by sending an 'initializeRequest' to the frontend.
		// The frontend will end the configuration sequence by calling 'configurationDone' request.
		this.sendEvent(new InitializedEvent());
	}

	/**
	 * Called at the end of the configuration sequence.
	 * Indicates that all breakpoints etc. have been sent to the DA and that the 'launch' can start.
	 */
	protected configurationDoneRequest(response: DebugProtocol.ConfigurationDoneResponse, args: DebugProtocol.ConfigurationDoneArguments): void {
		super.configurationDoneRequest(response, args);

		// notify the launchRequest that configuration has finished
		this._configurationDone.notify();
	}

	protected async launchRequest(response: DebugProtocol.LaunchResponse, args: ILaunchRequestArguments) {

		// make sure to 'Stop' the buffered logging if 'trace' is not set
		logger.setup(args.trace ? Logger.LogLevel.Verbose : Logger.LogLevel.Stop, false);

		// wait until configuration has finished (and configurationDoneRequest has been called)
		await this._configurationDone.wait(1000);

		// start the program in the runtime
		this.launchDebugeeConfig(args);

		this.sendResponse(response);
	}
}
