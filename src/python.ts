import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import * as hasbin from 'hasbin';
import * as crypto from 'crypto';

import * as vscode from 'vscode';

import { getExtensionPath } from './activateDeepDebug';

const deepDebuggerPrefix = "--deep-debugger-";
const deepDebuggerSessionNameSwitch = deepDebuggerPrefix + "session-name";
const deepDebuggerSessionCwdSwitch = deepDebuggerPrefix + "session-cwd";

function cloneDriver(origPythonPath: string): string {
    var tempPath = path.join(os.tmpdir(), 'DeepDebugger', 'python');
    var extensionPath = getExtensionPath();
    var parcedExtDir = path.parse(extensionPath);
    var parcedPythonPath = path.parse(origPythonPath);
    var driverFileName = "python_driver.sh";
    if (process.platform === 'win32') {
        driverFileName = "python_driver.exe";
        parcedExtDir.dir = parcedExtDir.dir.replace(':', path.sep);
        parcedPythonPath.dir = parcedPythonPath.dir.replace(':', path.sep);
    }

    var tempDriverDir;
    var relPath =path.relative(tempPath, origPythonPath);
    if (!relPath.startsWith('..') && relPath !== origPythonPath) {
        tempDriverDir = origPythonPath;
    } else {
        var pathTemp = path.join(parcedExtDir.dir, parcedExtDir.base, parcedPythonPath.dir);
        pathTemp = crypto.createHash('md5').update(pathTemp).digest("hex");
        tempDriverDir = path.join(tempPath, pathTemp);
        if (fs.mkdirSync(tempDriverDir, {recursive: true})) {
            fs.writeFileSync(path.join(tempDriverDir, 'parent.cfg'), 'path=' + origPythonPath + '\n');
        }
    }

    var tempDriverPath = path.join(tempDriverDir, parcedPythonPath.base);
    try {
        var origDriverPath = path.join(extensionPath, driverFileName);
        var lock = path.join(tempDriverDir, 'temp');
        fs.mkdirSync(lock);
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
        fs.rmdirSync(lock);
    } catch (e) {
        //
    }
    return tempDriverPath;
}

export function makeBinConfig(cfg, wf) {
    const DEFAULT_PYTHON_PATH = 'python';
    function notSet(pythonPath) {
        return !pythonPath || pythonPath === DEFAULT_PYTHON_PATH;
    }

    var origPythonPath = cfg.python;
    if (notSet(origPythonPath)) {
        origPythonPath = cfg.pythonPath;
    }
    const pythonSettings = vscode.workspace.getConfiguration(cfg.type);
    if (notSet(origPythonPath)) {
        origPythonPath = pythonSettings.get<string>('defaultInterpreterPath');
    }
    if (notSet(origPythonPath)) {
        origPythonPath = pythonSettings.get<string>('python');
    }
    if (notSet(origPythonPath)) {
        origPythonPath = pythonSettings.get<string>('pythonPath');
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
        deepDebuggerSessionNameSwitch, '"' + cfg.name + ' (binary extensions)"',
        ));
}

export function transformConfig(cfg) {

    var unquote = require('unquote');

    // https://stackoverflow.com/a/16261693/8321817
    cfg.args = cfg.cmdline.match(/(".*?"|[^"\s]+)+(?=\s*|\s*$)/g);
    delete(cfg.cmdline);

    var finalArgs = cfg.args;
    var pos = cfg.args.findIndex((v) => { return v.startsWith(deepDebuggerPrefix);});
    if (pos) {
        finalArgs = cfg.args.slice(1, pos);
    }

    for (var i = 1; i < cfg.args.length; ++i) {
        if (cfg.args[i] === deepDebuggerSessionNameSwitch) {
            cfg.name = unquote(cfg.args[++i]);
        }
        if (cfg.args[i] === deepDebuggerSessionCwdSwitch) {
            cfg.cwd = unquote(cfg.args[++i]);
        }
    }

    cfg.request = 'launch';
    if (cfg.program) {
        var pyEnvLauncher = undefined;
        var pythonPathParsed = path.parse(cfg.program);
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
                    const parts = str.split('=');
                    if (parts[0].trim() === 'home') {
                        if (parts[1]) {
                            pyEnvLauncher = cfg.program;
                            cfg.program = path.join(parts[1].trim(), pythonPathParsed.name + pythonPathParsed.ext);
                            break;
                        }
                    }
                }
            }
        }

        if (process.platform === "win32") {
            cfg.type = "cppvsdbg";
        }
        else {
            cfg.type = "cppdbg";
            cfg.MIMode = "gdb";
        }
        cfg.args = finalArgs;
        if (pyEnvLauncher) {
            cfg.environment.push({name: '__PYVENV_LAUNCHER__', value: pyEnvLauncher});
        }
        cfg.stopAtEntry = false;
        cfg.console = "integratedTerminal";
    }
    return true;
}
