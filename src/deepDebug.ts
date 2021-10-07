/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import {
	Logger, logger, LoggingDebugSession,
	InitializedEvent, TerminatedEvent, Thread
} from 'vscode-debugadapter';
import * as vscode from 'vscode';
import { DebugProtocol } from 'vscode-debugprotocol';
import { DeepRuntime } from './deepRuntime';
import { Subject } from 'await-notify';

import * as process from 'process';
import * as tempName from 'temp';
import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import { getExtensionPath } from './activateDeepDebug';

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
	private static threadID = 1;

	// a Deep runtime (or debugger)
	private _runtime: DeepRuntime;

	private _configurationDone = new Subject();

	private _cancellationTokens = new Map<number, boolean>();

	/**
	 * Creates a new debug adapter that is used for one debug session.
	 * We configure the default implementation of a debug adapter here.
	 */
	public constructor() {
		super("deep-debugger.txt");

		// this debugger uses zero-based lines and columns
		this.setDebuggerLinesStartAt1(false);
		this.setDebuggerColumnsStartAt1(false);

		this._runtime = new DeepRuntime();
		this._runtime.on('end', () => {
			this.sendEvent(new TerminatedEvent());
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

	protected getLaunchConfigData(name: string) {
		if (vscode.workspace.workspaceFolders) {
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

	protected getHook(mode) {
		var hookPath = path.join(getExtensionPath(), "hooks", mode + "Hook.js");
		return "node " + hookPath + " ";
	}

	protected launchDebugeeConfig(args: ILaunchRequestArguments) {

		var tempLauncherQueuePath = path.join(tempName.dir, "deepdbg-lque-" + process.env.VSCODE_PID);
		if (process.platform === "win32") {
			tempLauncherQueuePath = '\\\\?\\pipe\\' + tempLauncherQueuePath;
		}

		try {
			fs.accessSync(tempLauncherQueuePath, fs.constants.R_OK);
			fs.unlinkSync(tempLauncherQueuePath);
		} catch (err) {
		}

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
					vscode.debug.startDebugging(undefined, JSON.parse(param));
				}
			});			
		});
		server.listen(tempLauncherQueuePath);

		try {
			var cfgData = this.getLaunchConfigData(args['launch']);
			if (cfgData) {
				cfgData.cfg.name = cfgData.cfg.program;

				var env = [
					{name: 'DEEPDEBUGGER_LAUNCHER_QUEUE', value: tempLauncherQueuePath},
					{name: args['pythonHook']??'DEEPDBG_PYTHON_HOOK', value: this.getHook('python')},
					{name: args['cppHook']??'DEEPDBG_CPP_HOOK', value: this.getHook('cpp')},
					{name: args['bashHook']??'DEEPDBG_BASH_HOOK', value: this.getHook('bash')},
				];

				if (cfgData.cfg.type === 'cppdbg') {
					if (!cfgData.cfg.environment) {
						cfgData.cfg.environment = new Array;
					}
					this.setEnvAsArray(cfgData.cfg.environment, env);
				} else {
					if (!cfgData.cfg.env) {
						cfgData.cfg.env = new Object;
					}
					this.setEnvAsObject(cfgData.cfg.env, env);
				}

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

	protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {

		// runtime supports no threads so just return a default thread.
		response.body = {
			threads: [
				new Thread(DeepDebugSession.threadID, "thread 1")
			]
		};
		this.sendResponse(response);
	}
	protected cancelRequest(response: DebugProtocol.CancelResponse, args: DebugProtocol.CancelArguments) {
		if (args.requestId) {
			this._cancellationTokens.set(args.requestId, true);
		}
	}

	protected customRequest(command: string, response: DebugProtocol.Response, args: any) {
		super.customRequest(command, response, args);
	}
}
