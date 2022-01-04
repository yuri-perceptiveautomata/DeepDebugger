
var path = require('path');
var hook = require(path.join(path.dirname(process.argv[1]), 'hook'));

function beforeSessionCreate(session, msg) {
    // var callback = path.join(path.dirname(process.argv[1]), 'cppHookCallback.sh');
    // var cmd = callback + ' "' + session.process.argv[0] + '"';
    // var fs = require('fs')
    // var logfile = fs.openSync("/tmp/cppHookCallback.log", "w");
    // fs.writeFileSync(logfile, cmd);
    // msg.command = cmd;
    msg.type = (session.process.platform === "win32" ? "cppvsdbg" : "cppdbg");
    if (msg.type === "cppdbg") {
        msg.MIMode = "gdb";
        msg.setupCommands = [
            {
                description: "Enable pretty-printing for gdb",
                text: "-enable-pretty-printing",
                ignoreFailures: true
            }
        ];
    }
    msg.stopAtEntry = false;
}

function startDebugSession(block = true) {
    hook.startDebugSession('', block, beforeSessionCreate);
}

startDebugSession();
