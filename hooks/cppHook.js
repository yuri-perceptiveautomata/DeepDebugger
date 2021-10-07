var path = require('path');
var type = process.platform === "win32" ? "cppvsdbg" : "cppdbg";
var hook = require(path.join(path.dirname(process.argv[1]), 'hook'));
hook.startDebugSession(type, hook.cppEnvironment);
