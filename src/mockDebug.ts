/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import {
	Logger, logger, LoggingDebugSession,
	InitializedEvent, TerminatedEvent, Thread
} from 'vscode-debugadapter';
import * as vscode from 'vscode';
import { DebugProtocol } from 'vscode-debugprotocol';
import { DeepRuntime } from './mockRuntime';
import { Subject } from 'await-notify';

import * as process from 'process';
import * as tempName from 'temp';
import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import { getExtensionPath } from './activateMockDebug';

var deepDbgLog = -1;
if (process.platform === "win32") {
	deepDbgLog = fs.openSync("d:\\deepdbg.log", "w");
} else {
	deepDbgLog = fs.openSync("/home/yuri/git/somai/logs/deepdbg.log", "w");
}

function log(data: string) {
	if (deepDbgLog !== -1) {
		fs.writeFileSync(deepDbgLog, data + "\n");
	}
}

/**
 * This interface describes the deep-debugger specific launch attributes
 * (which are not part of the Debug Adapter Protocol).
 * The schema for these attributes lives in the package.json of the deep-debugger extension.
 * The interface should always match this schema.
 */
interface ILaunchRequestArguments extends DebugProtocol.LaunchRequestArguments {
	/** An absolute path to the "program" to debug. */
	program: string;
	/** Automatically stop target after launch. If not specified, target does not stop. */
	stopOnEntry?: boolean;
	/** enable logging the Debug Adapter Protocol */
	trace?: boolean;
	/** run without debugging */
	noDebug?: boolean;
	/** if specified, results in a simulated compile error in launch. */
	compileError?: 'default' | 'show' | 'hide';
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
/*
	protected prepareLauncher(args: ILaunchRequestArguments): string {
		tempName.track();

		var tempLauncherQueuePath = tempName.path("deepdbg-lque-");
		try {
			fs.accessSync(tempLauncherQueuePath, fs.constants.R_OK);
			fs.unlinkSync(tempLauncherQueuePath);
		} catch (err) {
		}

		var tempLauncherPath = tempName.path("deepdbg-launcher-");

		var script;
		if (process.platform === "win32") {
			tempLauncherPath += ".cmd";
			script = "echo %1 %2 %3 %4 %5";
		} else {
			if (!deepDbgLog) {
				deepDbgLog = fs.openSync("/home/yuri/git/somai/logs/deepdbg.log", "w");
			}
			child_process.execSync('mkfifo ' + tempLauncherQueuePath);
			script =  "#!/usr/bin/env sh\n";
			script += "# cleanup on exit, including Ctrl-C interruption\n";
			script += `trap "echo 'stop' >${tempLauncherQueuePath}; rm -f $0" EXIT\n`;
			script += `export DEEPDEBUGGER_LAUNCHER_QUEUE=${tempLauncherQueuePath}\n`;
			script += "$@\n";
		}

		var fd = fs.openSync(tempLauncherPath, "w");
		fs.writeSync(fd, script);
		fs.closeSync(fd);
		if (process.platform !== "win32") {
			fs.chmodSync(tempLauncherPath, 0o777);
		}

		fd = fs.openSync(tempLauncherQueuePath, 'r+');
		var inputStream = fs.createReadStream("", {fd});
		log(`starting... ${tempLauncherQueuePath}`);
		inputStream.on('data', d => {
			var commandArray = String(d).trim().split('|');
			log(`received: ${commandArray}`);
			if (commandArray.length < 1) {
				return;
			}
			var command = commandArray[0];
			//console.log(`command: ${command}`);
			if (command === 'stop') {
				//console.log(`closing ${tempLauncherQueuePath}`);
				inputStream.close();
				fs.unlinkSync(tempLauncherQueuePath);
				this.sendEvent(new TerminatedEvent());
			}
			if (command === 'start') {
				vscode.debug.startDebugging(undefined, JSON.parse(commandArray[1]));
			}
		});

		return tempLauncherPath + " " + args.program;
	}
*/

	protected getLaunchConfigData(name: string) {
		if (vscode.workspace.workspaceFolders !== undefined) {
			let wf = vscode.workspace.workspaceFolders[0];
			const configList = vscode.workspace.getConfiguration('launch', wf.uri).configurations;
			for (var idx in configList) {
				if (configList[idx].name === name) {
					return { wf: wf, cfg: JSON.parse(JSON.stringify(configList[idx])) };
				}
			}
		}
		return null;
	}

	protected setPythonEnvVariables(env, vars) {
		for (var v of vars) {
			env[v.name] = v.value;
		}
	}

	protected setCppEnvVariables(env, vars) {
		for (var v of vars) {
			env.push({name: v.name, value: v.value});
		}
	}

	protected getCppHook() {
		var hookPath = getExtensionPath() + "/hooks/cppHook.js";
		return "node " + hookPath;
// 		var tempLauncherPath = tempName.path("deepdbg-cpp-launcher-");
// 		var script;
// 		script =  "#!/usr/bin/env bash\n";
// //		script += "# cleanup on exit, including Ctrl-C interruption\n";
// //		script += "trap 'rm -f $0' EXIT\n";
// 		script += "ARG=''\n";
// 		script += "for var in ${@:2}\n";
// 		script += "do\n";
// 		script += "   if [[ \${ARG} ]]; then\n";
// 		script += "      ARG+=,\n";
// 		script += "   fi\n";
// 		script += "   ARG+=\"\\\"$var\\\"\"\n";
// 		script += "done\n";
// 		script += "ENV=''\n";
// 		script += "while IFS='=' read -r name value ; do\n";
// 		script += "   if [[ \${ENV} ]]; then\n";
// 		script += "      ENV+=,\n";
// 		script += "   fi\n";
// 		script += "  ENV+=\"{\\\"name\\\": \\\"${name}\\\", \\\"value\\\": \\\"${value}\\\"}\"\n";
// 		script += "done < <(env)\n";
// 		script += "MSG=('{' \\\n";
// 		script += "\'\"name\":\' \"\\\"$1\\\"\",\\\n";
// 		script += "\'\"type\":\' \'\"cppdbg\",\'\\\n";
// 		script += "\'\"request\":\' \'\"launch\",\'\\\n";
// 		script += "\'\"cwd\":\' \"\\\"$(pwd)\\\"\",\\\n";
// 		script += "\'\"program\":\' \"\\\"$(pwd)/$1\\\"\",\\\n";
// 		script += "\'\"environment\":\' \'[\'\\\n";
// //		script += "${ENV}\\\n";
// 		script += "\'],\'\\\n";
// 		script += "\'\"args\":\' \'[\'\\\n";
// 		script += "${ARG}\\\n";
// 		script += "\']\'\\\n";
// 		script += "\'}\')\n";
// 		script += "echo \"start\|${MSG[@]}\" >${DEEPDEBUGGER_LAUNCHER_QUEUE}\n";

// 		var fd = fs.openSync(tempLauncherPath, "w");
// 		fs.writeSync(fd, script);
// 		fs.closeSync(fd);
// 		if (process.platform !== "win32") {
// 			fs.chmodSync(tempLauncherPath, 0o777);
// 		}

// 		return tempLauncherPath;
	}

	protected launchDebugeeConfig(args: ILaunchRequestArguments) {

		if (process.platform === "win32") {
			var tempLauncherQueuePath = path.join('\\\\?\\pipe\\', process.cwd(), 'deepdbg-lque');
		} else {
			var tempLauncherQueuePath = tempName.path("deepdbg-lque-");
		}

		try {
			fs.accessSync(tempLauncherQueuePath, fs.constants.R_OK);
			fs.unlinkSync(tempLauncherQueuePath);
		} catch (err) {
		}

		var server = net.createServer(socket => {
			socket.on('data', d => {
				var commandArray = String(d).trim().split('|');
				if (commandArray.length < 1) {
					return;
				}
				var command = commandArray[0];
				if (command === 'start') {
					log(commandArray[1]);
					vscode.debug.startDebugging(undefined, JSON.parse(commandArray[1]));
				}
			});			
		});
		server.listen(tempLauncherQueuePath);
		
		var cfgData = this.getLaunchConfigData(args['launch']);
		if (cfgData) {
			cfgData.cfg.name = cfgData.cfg.program;

			var env = new Set;
			env.add({name: 'DEEPDEBUGGER_LAUNCHER_QUEUE', value: tempLauncherQueuePath});
			env.add({name: 'DEEPDBG_PYTHON_HOOK', value: "abcd"});
			env.add({name: 'DEEPDBG_CPP_HOOK', value: this.getCppHook()});

			if (cfgData.cfg.type === 'python') {
				if (!cfgData.cfg.env) {
					cfgData.cfg.env = new Object;
				}
				this.setPythonEnvVariables(cfgData.cfg.env, env);
			}

			if (cfgData.cfg.type === 'cppdbg') {
				if (!cfgData.cfg.environment) {
					cfgData.cfg.environment = new Array;
				}
				this.setCppEnvVariables(cfgData.cfg.environment, env);
			}
			log(JSON.stringify(cfgData));
			vscode.debug.startDebugging(cfgData.wf, cfgData.cfg);
		}

		this.sendEvent(new TerminatedEvent());
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

