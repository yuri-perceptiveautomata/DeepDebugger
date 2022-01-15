#!/bin/sh

LOG() {
    echo "$1" >> /tmp/hook.log
}

LOG "Hook started: $*"

HOOK_QUEUE=${DEEPDEBUGGER_LAUNCHER_QUEUE}.${DEEPDEBUGGER_SESSION_ID}
PARAM_TYPE="\"type\": \"\""
PARAM_CWD="\"cwd\": \"$(printf "%s" "${PWD}" | base64 -w 0)\""
PARAM_CMDLINE="\"cmdline\": \"$(while [ -n "$1" ]; do printf "%s" "$1" | base64 -w 0; printf "-"; shift; done)\""
PARAM_PARENTSESSION="\"deepDbgParentSessionID\": \"${DEEPDEBUGGER_SESSION_ID}\""
PARAM_HOOKPIPE="\"deepDbgHookPipe\": \"${HOOK_QUEUE}\""
LOG "Getting the environment"
PARAM_ENV_CONT=$(printenv | while IFS= read -r line; do (printf "%s" "${line}" | base64 -w 0); printf "-"; done)
PARAM_ENV="\"environment\": \"${PARAM_ENV_CONT}\""

PARAMS_JSON="{${PARAM_TYPE},${PARAM_CWD},${PARAM_CMDLINE},${PARAM_PARENTSESSION},${PARAM_HOOKPIPE},${PARAM_ENV}}"

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
