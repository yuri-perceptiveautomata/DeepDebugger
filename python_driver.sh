#!/bin/sh

SCRIPT_DIR="$(dirname "${BASH_ARGV0:-$0}")"

CMDLINE=$*
PROCNAME='python driver'

lock () {
    while ! mkdir -p "$1".lock 2>/dev/null
    do
        sleep .005
    done
}

release_lock() {
    rm -rf "$1".lock 2>/dev/null
}

LOG() {
    if [ -n "${LOGFILE}" ]
    then
        lock "${LOGFILE}"
        TIMESTAMP=$(date +"%4Y-%m-%d %H:%M:%S.%N"|cut -b -23)
        echo "[${TIMESTAMP}] ${PROCNAME} [$$] $1" >> "${LOGFILE}"
        release_lock "${LOGFILE}"
    fi
}

quote () {
    if echo "$1" | grep -q "[ ;]"
    then
        printf "'%s'" "$1";
    else
        printf "%s" "$1"
    fi
}

while [ -n "$1" ]; do
    if [ "$1" = "--deep-debugger-log-file" ]
    then
        LOGFILE="$2"
        shift
    else
        case "$1" in
            "--connect")
                LAUNCH_DEBUGGER=1;
                ;;
        esac
        ARGS="${ARGS} $(quote $1)"
        PARAM_ARGS="${PARAM_ARGS}"$(printf "%s" "$1" | base64 -w 0; printf "-")
    fi
    shift
done

LOG "Python driver started: ${CMDLINE}"

PYTHON_CFG="${SCRIPT_DIR}/parent.cfg"
LOG "Python config: ${PYTHON_CFG}"

if [ -f "${PYTHON_CFG}" ]; then
    PYTHON_PATH="$(cat ${PYTHON_CFG} | cut -b 6-)"
    LOG "Python path: ${PYTHON_PATH}"
fi

if [ -z "${LAUNCH_DEBUGGER}" ]; then
    LOG "Launching ${PYTHON_PATH}${ARGS}"
    ${PYTHON_PATH}${ARGS}
    exit $?
fi

HOOK_QUEUE=${DEEPDEBUGGER_LAUNCHER_QUEUE}.${DEEPDEBUGGER_SESSION_ID}
PARAM_TYPE="\"type\": \"$(printf "%s" "deepdbg-pythonBin" | base64 -w 0)\""
PARAM_CWD="\"cwd\": \"$(printf "%s" "${PWD}" | base64 -w 0)\""
PARAM_CMDLINE="\"cmdline\": \"${PARAM_ARGS}\""
PARAM_HOOKPIPE="\"deepDbgHookPipe\": \"${HOOK_QUEUE}\""
PARAM_PROGRAM=\"program\":\"$(printf "%s" "${PYTHON_PATH}" | base64 -w 0)\"
LOG "Getting the environment"
PARAM_ENV_CONT=$(printenv | while IFS= read -r line; do (printf "%s" "${line}" | base64 -w 0); printf "-"; done)
PARAM_ENV="\"environment\": \"${PARAM_ENV_CONT}\""

PARAMS_JSON="{${PARAM_TYPE},${PARAM_PROGRAM},${PARAM_CWD},${PARAM_CMDLINE},${PARAM_HOOKPIPE},${PARAM_ENV}}"

LOG "Sending data to ${DEEPDEBUGGER_LAUNCHER_QUEUE}: ${PARAMS_JSON}"
lock "${DEEPDEBUGGER_LAUNCHER_QUEUE}"
printf "%s" "${PARAMS_JSON}" > "${DEEPDEBUGGER_LAUNCHER_QUEUE}"
release_lock "${DEEPDEBUGGER_LAUNCHER_QUEUE}"

lock "${HOOK_QUEUE}"
if [ ! -p "${HOOK_QUEUE}" ]; then
    trap 'lock ${HOOK_QUEUE}; rm -f ${HOOK_QUEUE}; release_lock ${HOOK_QUEUE}' EXIT
    LOG "Creating fifo ${HOOK_QUEUE}"
    mkfifo "${HOOK_QUEUE}"
fi
release_lock "${HOOK_QUEUE}"

LOG "Waiting on ${HOOK_QUEUE}"
IFS= read -r line < "${HOOK_QUEUE}"
LOG "Received ${line}"
