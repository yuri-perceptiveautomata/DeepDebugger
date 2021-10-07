function cppEnvironment(msg) {
    delete msg.env;
    msg.environment = new Array;
    for (var e in process.env) {
        msg.environment.push({name: e, value: process.env[e]});
    }
};

function startDebugSession(type, cb) {
    var process = require('process');
    var queueName = process.env['DEEPDEBUGGER_LAUNCHER_QUEUE'];
    if (queueName) {
        var path = require('path');
        var hookPath = process.argv[2];
        var msg = {
            name: path.basename(hookPath),
            type: type,
            request: "launch",
            cwd: process.cwd(),
            program: path.isAbsolute(hookPath) ? hookPath : path.join(process.cwd(), hookPath),
            env: process.env,
            console: "integratedTerminal",
            args: process.argv.slice(3)
        };

        if (cb) {
            cb(msg);
        }

        var strMsg = "start|" + JSON.stringify(msg);

        var net = require('net');
        var client = new net.Socket();
        client.connect(queueName, function() {
            client.write(strMsg);
            client.destroy();
        });
    }
};

module.exports = {startDebugSession, cppEnvironment};
