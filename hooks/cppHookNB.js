var path = require('path');
var hook = require(path.join(path.dirname(process.argv[1]), 'cppHook'));
hook.startDebugSession(false);
