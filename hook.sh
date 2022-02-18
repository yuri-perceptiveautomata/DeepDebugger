#!/bin/sh

PROCNAME=hook
if [ -n "${DEEPDEBUGGER_LOGFILE}" ]
then
    LOGFILE="${DEEPDEBUGGER_LOGFILE}"
fi

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

LOG "Hook started: $*"

HOOK_QUEUE=${DEEPDEBUGGER_LAUNCHER_QUEUE}.$$
PARAM_TYPE="\"type\": \"\""
PARAM_CWD="\"cwd\": \"$(printf "%s" "${PWD}" | base64 -w 0)\""
PARAM_CMDLINE="\"cmdline\": \"$(while [ -n "$1" ]; do printf "%s" "$1" | base64 -w 0; printf "-"; shift; done)\""
PARAM_PARENTSESSION="\"deepDbgParentSessionID\": \"${DEEPDEBUGGER_SESSION_ID}\""
PARAM_HOOKPIPE="\"deepDbgHookPipe\": \"${HOOK_QUEUE}\""
LOG "Getting the environment"
PARAM_ENV_CONT=$(printenv | while IFS= read -r LINE; do (printf "%s" "${LINE}" | base64 -w 0); printf "-"; done)
PARAM_ENV="\"environment\": \"${PARAM_ENV_CONT}\""

PARAMS_JSON="{${PARAM_TYPE},${PARAM_CWD},${PARAM_CMDLINE},${PARAM_PARENTSESSION},${PARAM_HOOKPIPE},${PARAM_ENV}}"

LOG "Sending data to ${DEEPDEBUGGER_LAUNCHER_QUEUE}: ${PARAMS_JSON}"
lock "${DEEPDEBUGGER_LAUNCHER_QUEUE}"
printf "%s" "${PARAMS_JSON}" > "${DEEPDEBUGGER_LAUNCHER_QUEUE}"
release_lock "${DEEPDEBUGGER_LAUNCHER_QUEUE}"

lock "${HOOK_QUEUE}"
if [ ! -p "${HOOK_QUEUE}" ]
then
    trap 'lock ${HOOK_QUEUE}; rm -f ${HOOK_QUEUE}; release_lock ${HOOK_QUEUE}' EXIT
    LOG "Creating fifo ${HOOK_QUEUE}"
    mkfifo "${HOOK_QUEUE}"
fi
release_lock "${HOOK_QUEUE}"

LOG "Waiting on ${HOOK_QUEUE}"
IFS= read -r LINE < "${HOOK_QUEUE}"
LOG "Received ${LINE}"
