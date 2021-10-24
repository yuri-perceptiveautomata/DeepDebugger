
function startDebugSession(type, block = true, beforeSessionCreate = (session, msg) => {}, onSessionStarted = (session) => {}) {
    var process = require('process');
    var queueName = process.env['DEEPDEBUGGER_LAUNCHER_QUEUE'];
    parentSessionID = process.env['DEEPDEBUGGER_SESSION_ID'];
    var session = {
        process: process,
        parentSessionID: parentSessionID,
        launcherQueue: queueName,
        hookQueue: queueName + "." + parentSessionID
    };
    if (session.launcherQueue) {
        var net = require('net');
        var sender = new net.Socket();
        sender.connect(session.launcherQueue, function() {
            var fs = require('fs');
            var path = require('path');
            var programPath = process.argv[2];
            if (!path.isAbsolute(programPath)) {
                programPath = path.join(process.cwd(), programPath);
                if (!fs.existsSync(programPath)) {
                    var dirName = path.dirname(process.argv[2]);
                    if (dirName === '.') {
                        var splitPath = process.env['PATH'].split(process.platform === 'win32' ? ';' : ':');
                        for (var pathPart in splitPath) {
                            var testPath = path.join(splitPath[pathPart], process.argv[2]);
                            if (fs.existsSync(testPath)) {
                                programPath = testPath;
                                break;
                            }
                        }
                    }
                }
            }
            var msg = {
                name: path.basename(programPath),
                type: type,
                request: "launch",
                cwd: process.cwd(),
                program: programPath,
                console: "integratedTerminal",
                args: process.argv.slice(3)
            };
    
            msg.environment = new Array;
            for (var e in process.env) {
                msg.environment.push({name: e, value: process.env[e]});
            }
            
            msg.deepDbgParentSessionID = session.parentSessionID;

            if (block) {
                msg.deepDbgHookPipe = session.hookQueue;
                var listener = net.createServer(socket => {
                    socket.on('data', d => {
                        var command = String(d).trim();
                        if (command.substring(0,7) === 'started') {
                            if (onSessionStarted) {
                                onSessionStarted(session);
                            }
                        } else if (command === 'stopped') {
                            listener.close();
                            // if (process.platform !== "win32") {
                            //     var fs = require('fs');
                            //     fs.unlink();
                            // }
                        }
                    });
                });
                listener.listen(session.hookQueue);
            }

            if (beforeSessionCreate) {
                beforeSessionCreate(session, msg);
            }

            var strMsg = "start|" + JSON.stringify(msg);
            sender.write(strMsg);
            sender.destroy();
        });
    }
};

module.exports = {startDebugSession};
