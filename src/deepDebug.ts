import {
	Logger, logger, LoggingDebugSession,
	InitializedEvent, TerminatedEvent
} from 'vscode-debugadapter';
import * as vscode from 'vscode';
import { DebugProtocol } from 'vscode-debugprotocol';
import { Subject } from 'await-notify';

import * as process from 'process';
import * as tempName from 'temp';
import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import { randomBytes } from 'crypto';
import { getExtensionPath } from './activateDeepDebug';

const envNameSessionId = 'DEEPDEBUGGER_SESSION_ID';
const propNameSessionId = 'deepDbgSessionID';
const propNameParentSessionId = 'deepDbgParentSessionID';
const debugSessionsHierarchy = 'debugSessionsHierarchy';
const deepDebuggerPrefix = "--deep-debugger-";

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

export class DeepDebugSession extends LoggingDebugSession {

	// we don't support multiple threads, so we can use a hardcoded ID for the default thread
	private static sessionID = 0;
	private static sessionDict = new Map<string, vscode.DebugSession>();
	private static useHierarchy = false;

	private _configurationDone = new Subject();

	/**
	 * Creates a new debug adapter that is used for one debug session.
	 * We configure the default implementation of a debug adapter here.
	 */
	public constructor() {
		super("deep-debugger.txt");

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
				var client = new net.Socket();
				client.connect(session.configuration.deepDbgHookPipe, function() {
					client.write('stopped');
					client.destroy();
				});
			}
		});
	}

	static deepDbgLog = -1;
	static enableLogging = false;
	static log(data: string) {
		if (DeepDebugSession.enableLogging) {
			if (DeepDebugSession.deepDbgLog === -1) {
				DeepDebugSession.deepDbgLog = fs.openSync(path.join(tempName.dir, "deepdbg.log"), "w");
			}
			fs.writeFileSync(DeepDebugSession.deepDbgLog, data + "\n");
		}
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

	protected findNode() {
		var nodePath = 'node';
		var isNodeAvailable = require('hasbin').sync(nodePath);
		if (isNodeAvailable) {
			return nodePath;
		}
		var binPath = path.join(getExtensionPath(), "../../bin");
		var binPathFiles = fs.readdirSync(binPath);
		var isNode = function (f) {
			if (process.platform === "win32") {
				return f.toLowerCase() === 'node.exe';
			} else {
				return f === 'node';
			}
		};
		for (var b of binPathFiles) {
			var binDir = path.join(binPath, b);
			if (fs.lstatSync(binDir).isDirectory()) {
				var files = fs.readdirSync(binDir);
				for (var file of files) {
					if (isNode(file)) {
						return path.join(binDir, file);
					}
				}
			}
		}
		return "";
	}

	protected getHookPath(mode, block: boolean = true) {
		var hookPath = path.join(getExtensionPath(), "hooks", mode + "Hook" + (block? "" : "NB") + ".js");
		return hookPath;
	}

	protected getHook(mode, block: boolean = true) {
		var nodePath = this.findNode();
		if (nodePath) {
			var hookPath = this.getHookPath(mode, block);
			return nodePath + " " + hookPath + " ";
		}
		return '';
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

	protected launchDebugeeConfig(args: ILaunchRequestArguments) {

		const pipeName = args['messageQueueName']??("deepdbg-lque-" + randomBytes(10).toString('hex'));
		var tempLauncherQueuePath = path.join(tempName.dir, pipeName);
		if (process.platform === "win32") {
			tempLauncherQueuePath = '\\\\?\\pipe\\' + tempLauncherQueuePath;
		}

		try {
			fs.accessSync(tempLauncherQueuePath, fs.constants.R_OK);
			fs.unlinkSync(tempLauncherQueuePath);
		} catch (err) {
		}

		DeepDebugSession.useHierarchy = args[debugSessionsHierarchy] ?? false;

		var server = net.createServer(socket => {
			socket.on('data', d => {
				DeepDebugSession.log(String(d));
				var commandArray = String(d).trim().split('|');
				if (commandArray.length < 1) {
					return;
				}
				var command = commandArray[0];
				if (command === 'start') {
					var param = commandArray.slice(1).join('|');
					DeepDebugSession.log(param);
					var cfg = JSON.parse(param);
					var env = cfg.environment;
					cfg.environment = new Array;
					this.setConfigEnvironment(cfg, env);
					var parentSession: vscode.DebugSession | undefined;
					if (DeepDebugSession.useHierarchy) {
						if (cfg.hasOwnProperty(propNameParentSessionId)) {
							parentSession = DeepDebugSession.sessionDict[cfg[propNameParentSessionId]];
						}
					}
					vscode.debug.startDebugging(undefined, cfg, parentSession);
				}
			});
		});
		server.listen(tempLauncherQueuePath);

		try {
			var env = [
				{name: 'DEEPDEBUGGER_LAUNCHER_QUEUE', value: tempLauncherQueuePath},
				{name: args['pythonHook']??'DEEPDBG_PYTHON', value: this.getHook('python')},
				{name: args['cppHook']??'DEEPDBG_CPP', value: this.getHook('cpp')},
				{name: args['cppHookNoBlock']??'DEEPDBG_CPP_NB', value: this.getHook('cpp', false)},
				{name: args['bashHook']??'DEEPDBG_BASH', value: this.getHook('bash')},
				{name: args['bashHookNoBlock']??'DEEPDBG_BASH_NB', value: this.getHook('bash', false)},
				{name: args['spawnHook']??'DEEPDBG_SPAWN', value: this.getHook('spawn')},
			];
			if (args.hasOwnProperty('environment')) {
				env = env.concat(args['environment']);
			}

			var launch = args['launch'];
			var cfgData = this.getLaunchConfigData(launch);
			if (!cfgData) {
				// const cp = require('child_process');
				// var exec_env = process.env;
				// this.setEnvAsObject(exec_env, env);
				// cp.exec(launch, {env: exec_env});
				var terminalName = "Deep Debugger";
				var terminal = vscode.window.terminals.find(t => t.name === terminalName);
				terminal?.dispose();
				terminal = vscode.window.createTerminal(terminalName);
				terminal.show();
				var setCmd = process.platform === 'win32' ? "set" : "export";
				for (var v of env) {
					terminal.sendText(setCmd + " " + v.name + "=\"" + v.value + "\"");
				}
				terminal.sendText(launch.join(' '));
			} else {
				cfgData.cfg.name = cfgData.cfg.program;

				if (cfgData.cfg.type === 'python' && cfgData.cfg.request === 'launch') {
					const pythonSettings = vscode.workspace.getConfiguration(cfgData.cfg.type);
					var oldPythonPath = pythonSettings.get<string>('defaultInterpreterPath');
					if (!oldPythonPath || oldPythonPath === 'python') {
						oldPythonPath = pythonSettings.get<string>('pythonPath');
					}
					if (cfgData.cfg.python) {
						oldPythonPath = cfgData.cfg.python;
					}
					if (oldPythonPath) {
						env = env.concat({name: "DEEPDEBUGGER_PYTHON_PATH", value: oldPythonPath});
						process.env.DEEPDEBUGGER_PYTHON_PATH = oldPythonPath;
					}
					var extensionPath = getExtensionPath();
					if (process.platform === 'win32') {
						cfgData.cfg.python = extensionPath + "\\python_driver.exe";
					} else {
						cfgData.cfg.python = extensionPath + "/python_driver";
					}
					if (!cfgData.cfg.args) {
						cfgData.cfg.args = Array();
					}
					cfgData.cfg.args = cfgData.cfg.args.concat(Array(
						deepDebuggerPrefix + "python-path", oldPythonPath,
						deepDebuggerPrefix + "nodejs-path", this.findNode(),
						deepDebuggerPrefix + "binary-hook", this.getHookPath('cpp'),
						deepDebuggerPrefix + "session-name", '"' + cfgData.cfg.name + ' (binary extensions)"',
						));
				}

				this.setConfigEnvironment(cfgData.cfg, env);

				DeepDebugSession.log(JSON.stringify(cfgData));
				vscode.debug.startDebugging(cfgData.wf, cfgData.cfg);
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
		response.body.completionTriggerCharacters = [ ".", "[" ];

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
				label: "Named Exception",
				description: `Break on named exceptions. Enter the exception's name as the Condition.`,
				default: false,
				supportsCondition: true,
				conditionDescription: `Enter the exception's name`
			},
			{
				filter: 'otherExceptions',
				label: "Other Exceptions",
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
