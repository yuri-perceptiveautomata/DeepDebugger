import * as fs from 'fs';
import * as path from 'path';

export function transformConfig(cfg) {
    // https://stackoverflow.com/a/16261693/8321817
    var args = cfg.cmdline.match(/(".*?"|[^"\s]+)+(?=\s*|\s*$)/g).slice(1);
    if (!cfg.program) {
        cfg.program = args[0];
        cfg.args = args.slice(1);
    } else {
        cfg.args = args;
    }
    delete(cfg.cmdline);

    if (!path.isAbsolute(cfg.program)) {
        cfg.program = path.join(cfg.cwd, cfg.program);
        if (!fs.existsSync(cfg.program)) {
            var dirName = path.dirname(process.argv[2]);
            if (dirName === '.') {
                var envPath = cfg.environment.find(e => e.name === 'PATH');
                if (envPath) {
                    var splitPath = envPath.value.split(process.platform === 'win32' ? ';' : ':');
                    for (var pathPart in splitPath) {
                        var testPath = path.join(splitPath[pathPart], process.argv[2]);
                        if (fs.existsSync(testPath)) {
                            cfg.program = testPath;
                            break;
                        }
                    }
                }
            }
        }
    }

    if (!cfg.name) {
        cfg.name = path.basename(cfg.program);
    }

    cfg.request = 'launch';
    if (process.platform === 'win32') {
        cfg.type = 'cppvsdbg';
    }
    else {
        cfg.type = 'cppdbg';
        cfg.MIMode = 'gdb';
        cfg.setupCommands = [
            {
                description: 'Enable pretty-printing for gdb',
                text: '-enable-pretty-printing',
                ignoreFailures: true
            }
        ];
    }
    cfg.stopAtEntry = false;
    cfg.console = 'integratedTerminal';
    return true;
}
