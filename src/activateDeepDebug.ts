/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

'use strict';

import * as vscode from 'vscode';
import { WorkspaceFolder, DebugConfiguration, ProviderResult, CancellationToken } from 'vscode';
import { DeepDebugSession } from './deepDebug';

import { setExtensionContext } from './common';

export function activateDeepDebug(context: vscode.ExtensionContext, factory?: vscode.DebugAdapterDescriptorFactory) {

	setExtensionContext(context);

	context.subscriptions.push(vscode.commands.registerCommand('extension.deep-debugger.getProgramName', config => {
		return vscode.window.showInputBox({
			placeHolder: "Please enter the configuration name to launch",
			value: ""
		});
	}));

	// register a configuration provider for 'deepdbg' debug type
	const provider = new DeepDbgConfigurationProvider();
	context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('deepdbg', provider));

	if (!factory) {
		factory = new InlineDebugAdapterFactory();
	}
	context.subscriptions.push(vscode.debug.registerDebugAdapterDescriptorFactory('deepdbg', factory));
	if ('dispose' in factory) {
		context.subscriptions.push(factory);
	}
}

function checkLaunchConfig(config: DebugConfiguration): boolean {
	if (typeof config.launch === 'string' && vscode.workspace.workspaceFolders !== undefined) {
		const configList = vscode.workspace.getConfiguration('launch', vscode.workspace.workspaceFolders[0].uri).configurations;
		for (var cfg of configList) {
			if (cfg.name === config.launch) {
				return true;
			}
		}
	} else if (Array.isArray(config.launch)) {
		// we asume the array contains parts of a command line
		//TBD: return false if the command line is invalid or not executable
		return true;
	}
	return false;
}

class DeepDbgConfigurationProvider implements vscode.DebugConfigurationProvider {

	/**
	 * Massage a debug configuration just before a debug session is being launched,
	 * e.g. add all missing attributes to the debug configuration.
	 */
	resolveDebugConfiguration(folder: WorkspaceFolder | undefined, config: DebugConfiguration, token?: CancellationToken): ProviderResult<DebugConfiguration> {

		// if launch.json is missing or empty
		if (!config.type && !config.request && !config.name) {
			const editor = vscode.window.activeTextEditor;
			if (editor) {
				config.name = 'Deep Debug';
				config.type = 'deepdbg';
				config.request = 'launch';
				config.trace = true;
				config['launch'] = "<name of a configuration to launch>";
			}
		}

		if (!checkLaunchConfig(config)) {
			return vscode.window.showInformationMessage("Cannot find a start configuration. Please use \"launch\": \"<name of a configuration to launch>\".").then(_ => {
				return undefined;	// abort launch
			});
		}

		return config;
	}
}

class InlineDebugAdapterFactory implements vscode.DebugAdapterDescriptorFactory {

	createDebugAdapterDescriptor(_session: vscode.DebugSession): ProviderResult<vscode.DebugAdapterDescriptor> {
		return new vscode.DebugAdapterInlineImplementation(new DeepDebugSession);
	}
}
