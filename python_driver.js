var fs = require('fs');
var path = require('path');
var unquote = require('unquote');
const { exec } = require('child_process');

function quote(s) {
    return '\"' + s + '\"';
}

function main() {
    const SPACE = ' ';
    const CONNECT_SWITCH = '--connect';
    const DEEP_DEBUGGER_PREFIX  = '--deep-debugger-';
    const HOOK_SWITCH = DEEP_DEBUGGER_PREFIX + 'binary-hook';
    const NODE_PATH_SWITCH = DEEP_DEBUGGER_PREFIX + 'nodejs-path';
    const SESSION_NAME_SWITCH = DEEP_DEBUGGER_PREFIX + 'session-name';
    const PYTHON_PATH_SWITCH = DEEP_DEBUGGER_PREFIX + 'python-path';

    var cmdline = process.argv;
    var args = cmdline.slice(2);
    var finalArgs = args;
    var pos = finalArgs.findIndex((v) => { return v.startsWith(DEEP_DEBUGGER_PREFIX);});
    if (pos) {
        finalArgs = finalArgs.slice(0, pos);
    }

    var pythonPath = process.env.DEEPDEBUGGER_PYTHON_PATH;
    var nodejsPath, hookPath, sessionName;

    var launchDebugger = false;
    for (var i = 1; i < cmdline.length; ++i) {
        if (cmdline[i] === CONNECT_SWITCH) {
            launchDebugger = true;
        }
        if (cmdline[i] === PYTHON_PATH_SWITCH) {
            pythonPath = unquote(cmdline[++i]);
        }
        if (cmdline[i] === NODE_PATH_SWITCH) {
            nodejsPath = unquote(cmdline[++i]);
        }
        if (cmdline[i] === HOOK_SWITCH) {
            hookPath = unquote(cmdline[++i]);
        }
        if (cmdline[i] === SESSION_NAME_SWITCH) {
            sessionName = unquote(cmdline[++i]);
        }
    }

    if (!pythonPath) {
        return 1;
    }

    if (!launchDebugger) {
        var cmd = Array(quote(pythonPath.trim())).concat(args);
        return exec(cmd.join(SPACE));
    }
  
    if (!hookPath || !nodejsPath) {
        return 1;
    }
    
    var pythonPathParsed = path.parse(pythonPath);
    var penvDir = pythonPathParsed.dir;
    if (!penvDir.empty) {
        const CFG_NAME = 'pyvenv.cfg';
        var pyenvCfgPath = path.join(penvDir, CFG_NAME);
        if (!fs.existsSync(pyenvCfgPath)) {
            penvDir = path.parse(penvDir).dir;
            pyenvCfgPath = path.join(penvDir, CFG_NAME);
        }
        if (fs.existsSync(pyenvCfgPath)) {
            const data = fs.readFileSync(pyenvCfgPath, 'utf8').split('\n');
            for (str of data) {
                if (str.empty) {
                    continue;
                }
                const parts = str.split('=');
                if (parts[0].trim() === 'home') {
                    if (!parts[1].empty) {
                        process.env.__PYVENV_LAUNCHER__ = pythonPath;
                        pythonPath = path.join(parts[1].trim(), pythonPathParsed.name + pythonPathParsed.ext);
                        break;
                    }
                }
            }
        }
    }

    var pythonPathQuoted = quote(pythonPath.trim());
    var nodejsPathQuoted = quote(nodejsPath.trim());
    var hookPathQuoted = quote(hookPath.trim());

    var cmd = Array(nodejsPathQuoted, hookPathQuoted, pythonPathQuoted).concat(finalArgs);

    if (sessionName) {
        var sessionNameQuoted = quote(sessionName.trim());
        cmd = cmd.concat(Array(SESSION_NAME_SWITCH, sessionNameQuoted));
    }

    return exec(cmd.join(SPACE));
}

main();
