#!/bin/sh

SCRIPT_DIR="$( cd "$(dirname "${BASH_ARGV0:-$0}")" ; pwd -P )"
SCRIPT_NAME="(basename "${BASH_ARGV0:-$0}")"

LOG() {
    echo "$1" >> "/tmp/${SCRIPT_NAME}.log"
}

LOG "python_driver started: $*"

LAUNCH_DEBUGGER=0
while [[ -n $1 ]]; do
    case "$1" in
        "--connect")
            LAUNCH_DEBUGGER=1;
            LOG "--connect found, debug session will be launched"
            shift ;;
    esac
    shift
done

CFG_PATH="${SCRIPT_DIR}/parent.cfg"
if [ ! -f "${CFG_PATH}" ]; then
    LOG "Config file not found (${CFG_PATH}), exiting"
    exit 1
fi

source "${CFG_PATH}"
PYTHON_PATH="${path}"

if [ -z "${LAUNCH_DEBUGGER}" ]; then
    LOG "Launching ${PYTHON_PATH} $*"
    "${PYTHON_PATH}" "$*"
    exit 0
fi

HOOK_QUEUE=${DEEPDEBUGGER_LAUNCHER_QUEUE}.${DEEPDEBUGGER_SESSION_ID}
PARAM_TYPE="\"type\": \"\""
PARAM_CWD="\"cwd\": \"$(printf "%s" "${PWD}" | base64 -w 0)\""
PARAM_CMDLINE="\"cmdline\": \"$(printf "%s %s" "$0" "$*" | base64 -w 0)\""
PARAM_HOOKPIPE="\"deepDbgHookPipe\": \"${HOOK_QUEUE}\""
LOG "Getting the environment"
PARAM_ENV_CONT=$(printenv | while IFS= read -r line; do (printf "%s" "${line}" | base64 -w 0); printf "-"; done)
PARAM_ENV="\"environment\": \"${PARAM_ENV_CONT}\""

PARAMS_JSON="{${PARAM_TYPE},\"program\":${PYTHON_PATH},${PARAM_CWD},${PARAM_CMDLINE},${PARAM_HOOKPIPE},${PARAM_ENV}}"

LOG "Sending data to ${DEEPDEBUGGER_LAUNCHER_QUEUE}: ${PARAMS_JSON}"
printf "%s" "${PARAMS_JSON}" > "${DEEPDEBUGGER_LAUNCHER_QUEUE}"

if [ ! -p "${HOOK_QUEUE}" ]; then
    trap 'rm -f ${HOOK_QUEUE}' EXIT
    LOG "Creating fifo ${HOOK_QUEUE}"
    mkfifo "${HOOK_QUEUE}"
fi

LOG "Waiting on ${HOOK_QUEUE}"
IFS= read -r line < "${HOOK_QUEUE}"
LOG "Received ${line}"
