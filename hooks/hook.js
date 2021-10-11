
function startDebugSession(type, block = true) {
    var process = require('process');
    var queueName = process.env['DEEPDEBUGGER_LAUNCHER_QUEUE'];
    if (queueName) {
        var net = require('net');
        var sender = new net.Socket();
        sender.connect(queueName, function() {
            var path = require('path');
            var hookPath = process.argv[2];
            var msg = {
                name: path.basename(hookPath),
                type: type,
                request: "launch",
                cwd: process.cwd(),
                program: path.isAbsolute(hookPath) ? hookPath : path.join(process.cwd(), hookPath),
                console: "integratedTerminal",
                args: process.argv.slice(3)
            };
    
            msg.environment = new Array;
            for (var e in process.env) {
                msg.environment.push({name: e, value: process.env[e]});
            }
            
            msg.deepDbgParentSessionID = process.env['DEEPDEBUGGER_SESSION_ID'];

            if (block) {
                msg.deepDbgHookPipe = queueName + "." + msg.deepDbgParentSessionID;
                var listener = net.createServer(socket => {
                    socket.on('data', d => {
                        var command = String(d).trim();
                        if (command === 'stopped') {
                            listener.destroy();
                            // if (process.platform !== "win32") {
                            //     var fs = require('fs');
                            //     fs.unlink();
                            // }
                        }
                    });
                });
                listener.listen(msg.deepDbgHookPipe);
            }

            var strMsg = "start|" + JSON.stringify(msg);
            sender.write(strMsg);
            sender.destroy();
        });
    }
};

module.exports = {startDebugSession};
