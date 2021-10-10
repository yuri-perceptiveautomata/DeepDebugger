var path = require('path');
var hook = require(path.join(path.dirname(process.argv[1]), 'hook'));
hook.startDebugSession(process.platform === "win32" ? "cppvsdbg" : "cppdbg");
