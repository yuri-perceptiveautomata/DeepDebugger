var path = require('path');
require(path.join(path.dirname(process.argv[1]), 'hook')).startDebugSession("bashdb");
