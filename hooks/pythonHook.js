var process = require('process');
var queueName = process.env['DEEPDEBUGGER_LAUNCHER_QUEUE'];
if (queueName) {
    var path = require('path');
    var msg = {
        name: path.basename(process.argv[2]),
        type: process.platform === "win32" ? "cppvsdbg" : "cppdbg",
        request: "launch",
        cwd: process.cwd(),
        program: path.join(process.cwd(), process.argv[2]),
        environment: new Array,
        console: "integratedTerminal",
        args: process.argv.slice(3)
    };
    for (var e in process.env) {
        msg.environment.push({name: e, value: process.env[e]});
    }
    var strMsg = "start|" + JSON.stringify(msg);

    var net = require('net');

    var client = new net.Socket();
    client.connect(queueName, function() {
        client.write(strMsg);
        client.destroy();
    });
}
