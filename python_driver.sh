#!/usr/bin/env bash

SCRIPT_DIR="$( cd "$(dirname "${BASH_ARGV0:-$0}")" ; pwd -P )"

ARGS=$*
DEEP_DEBUGGER_PREFIX=--deep-debugger-

while [[ -n $1 ]]; do
    case "$1" in 
        "${DEEP_DEBUGGER_PREFIX}nodejs-path")
            NODEJS_PATH=$2
            shift ;;
    esac
    shift
done

${NODEJS_PATH} ${SCRIPT_DIR}/python_driver.js ${ARGS}
