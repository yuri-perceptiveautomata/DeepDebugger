import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import * as hasbin from 'hasbin';
import * as crypto from 'crypto';

import * as vscode from 'vscode';

import { getExtensionPath } from './activateDeepDebug';
import { DeepDebugSession, getLock, releaseLock } from './deepDebug';

const deepDebuggerPrefix = '--deep-debugger-';
const deepDebuggerSessionNameSwitch = deepDebuggerPrefix + 'session-name';
const deepDebuggerSessionCwdSwitch = deepDebuggerPrefix + 'session-cwd';

const PYTHON = 'python';

function getPythonPath(): string {
    try {
        const extension = vscode.extensions.getExtension("ms-python.python");
        if (!extension) {
            return PYTHON;
        }
        const usingNewInterpreterStorage = extension.packageJSON?.featureFlags?.usingNewInterpreterStorage;
        if (usingNewInterpreterStorage) {
            if (!extension.isActive) {
                extension.activate();
            }
            const execCommand = extension.exports.settings.getExecutionDetails ?
                extension.exports.settings.getExecutionDetails().execCommand :
                extension.exports.settings.getExecutionCommand();
            return execCommand ? execCommand.join(" ") : PYTHON;
        } else {
            var pythonConfig = vscode.workspace.getConfiguration(PYTHON);
            var retval = pythonConfig.get<string>("pythonPath");
            return retval? retval : PYTHON;
        }
    } catch (error) {
        return PYTHON;
    }
}

function getInterpreter(pythonPath) {
    var pyEnvLauncher = undefined, version: string = '';
    var pythonPathParsed = path.parse(pythonPath);
    var penvDir = pythonPathParsed.dir;
    if (penvDir) {
        const CFG_NAME = 'pyvenv.cfg';
        var pyenvCfgPath = path.join(penvDir, CFG_NAME);
        if (!fs.existsSync(pyenvCfgPath)) {
            penvDir = path.parse(penvDir).dir;
            pyenvCfgPath = path.join(penvDir, CFG_NAME);
        }
        if (fs.existsSync(pyenvCfgPath)) {
            const data = fs.readFileSync(pyenvCfgPath, 'utf8').split('\n');
            for (var str of data) {
                if (!str) {
                    continue;
                }
                const parts = str.split('=').map(x => { return x.trim(); });
                if (parts[0] === 'home' && parts[1]) {
                    pyEnvLauncher = pythonPath;
                    pythonPath = path.join(parts[1], pythonPathParsed.name + pythonPathParsed.ext);
                }
                if (parts[0] === 'version' && parts[1]) {
                    version = parts[1];
                }
            }
        }
    }
    if (process.platform !== 'win32') {
        if (version.startsWith('3')) {
            pythonPath += '3';
        }
    }
    return {path: pythonPath, version: version, launcher: pyEnvLauncher};
}

function cloneDriver(origPythonPath: string): string {
    var tempPath = path.join(os.tmpdir(), 'DeepDebugger', PYTHON);
    var extensionPath = getExtensionPath();
    var parcedExtDir = path.parse(extensionPath);

    var pyInfo = getInterpreter(origPythonPath);

    var parcedPythonPath = path.parse(pyInfo.path);
    var driverFileName = 'python_driver.sh';
    if (process.platform === 'win32') {
        driverFileName = 'python_driver.exe';
        parcedExtDir.dir = parcedExtDir.dir.replace(':', path.sep);
        parcedPythonPath.dir = parcedPythonPath.dir.replace(':', path.sep);
    }

    var tempDriverDir;
    var relPath = path.relative(tempPath, pyInfo.path);
    if (!relPath.startsWith('..') && relPath !== pyInfo.path) {
        tempDriverDir = pyInfo.path;
    } else {
        var pathTemp = path.join(parcedExtDir.dir, parcedExtDir.base, parcedPythonPath.dir);
        pathTemp = crypto.createHash('md5').update(pathTemp).digest('hex');
        tempDriverDir = path.join(tempPath, pathTemp);
        if (fs.mkdirSync(tempDriverDir, {recursive: true})) {
            fs.writeFileSync(path.join(tempDriverDir, 'parent.cfg'), 'path=' + pyInfo.launcher + '\n');
        }
    }

    var tempDriverPath = path.join(tempDriverDir, parcedPythonPath.base);
    try {
        var origDriverPath = path.join(extensionPath, driverFileName);
        getLock(tempDriverDir);
        var driverNeedsUpdate = !fs.existsSync(tempDriverPath);
        if (!driverNeedsUpdate) {
            var stat1 = fs.statSync(origDriverPath);
            var stat2 = fs.statSync(tempDriverPath);
            if (stat1.mtime > stat2.mtime) {
                driverNeedsUpdate = true;
            }
        }
        if (driverNeedsUpdate) {
            fs.copyFileSync(origDriverPath, tempDriverPath);
        }
        releaseLock(tempDriverDir);
    } catch (e) {
        //
    }
    return tempDriverPath;
}

export function makeBinConfig(cfg, wf) {
    const DEFAULT_PYTHON_PATH = PYTHON;
    function notSet(pythonPath) {
        return !pythonPath || pythonPath === DEFAULT_PYTHON_PATH;
    }

    var origPythonPath = cfg.python;
    if (notSet(origPythonPath)) {
        origPythonPath = cfg.pythonPath;
    }
    const pythonSettings = vscode.workspace.getConfiguration(PYTHON);
    if (notSet(origPythonPath)) {
        origPythonPath = pythonSettings.get<string>('defaultInterpreterPath');
    }
    if (notSet(origPythonPath)) {
        origPythonPath = pythonSettings.get<string>(PYTHON);
    }
    if (notSet(origPythonPath)) {
        origPythonPath = pythonSettings.get<string>('pythonPath');
    }
    if (notSet(origPythonPath)) {
        origPythonPath = getPythonPath();
    }
    if (notSet(origPythonPath)) {
        origPythonPath = hasbin.sync(DEFAULT_PYTHON_PATH);
    }

    cfg.python = cloneDriver(origPythonPath);

    if (!cfg.args) {
        cfg.args = Array();
    }
    cfg.args = cfg.args.concat(Array(
        deepDebuggerSessionCwdSwitch, cfg.cwd ? cfg.cwd : wf.uri.fsPath,
        deepDebuggerSessionNameSwitch, cfg.name + ' (binary extensions)',
        ));
}

export function transformConfig(cfg, session: DeepDebugSession) {

    var unquote = require('unquote');

    var pos = cfg.args.findIndex((v) => { return v.startsWith(deepDebuggerPrefix);});
    if (!pos) {
        return false;
    }
    var finalArgs = cfg.args;

    for (var i = 1; i < cfg.args.length; ++i) {
        if (cfg.args[i] === deepDebuggerSessionNameSwitch) {
            cfg.name = unquote(cfg.args[++i]);
        }
        if (cfg.args[i] === deepDebuggerSessionCwdSwitch) {
            cfg.cwd = unquote(cfg.args[++i]);
        }
    }

    if (cfg.program) {
        var pyInfo = getInterpreter(cfg.program);
        cfg.program = pyInfo.path;

        cfg.type = 'binary';
        session.decodeEnvironment(cfg);
        session.platform.setBinaryConfigType(cfg);

        cfg.args = finalArgs;
        if (pyInfo.launcher) {
            cfg.environment.push({name: '__PYVENV_LAUNCHER__', value: pyInfo.launcher});
        }
    }
    return true;
}
