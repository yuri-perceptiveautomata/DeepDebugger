#!/bin/sh

HOOK_QUEUE=${DEEPDEBUGGER_LAUNCHER_QUEUE}.${DEEPDEBUGGER_SESSION_ID}
PARAM_TYPE="\"type\": \"\""
PARAM_CWD="\"cwd\": \"$(printf "%s" "${PWD}" | base64 -w 0)\""
PARAM_CMDLINE="\"cmdline\": \"$(printf "%s %s" "$0" "$*" | base64 -w 0)\""
PARAM_HOOKPIPE="\"deepDbgHookPipe\": \"${HOOK_QUEUE}\""
PARAM_ENV_CONT=`printenv | while IFS= read -r line; do (printf "%s" "${line}" | base64 -w 0); printf "-"; done`
PARAM_ENV="\"environment\": \"${PARAM_ENV_CONT}\""

PARAMS_JSON="{${PARAM_TYPE},${PARAM_CWD},${PARAM_CMDLINE},${PARAM_HOOKPIPE},${PARAM_ENV}}"

printf "start|%s" "${PARAMS_JSON}" > ${DEEPDEBUGGER_LAUNCHER_QUEUE}
read line < ${HOOK_QUEUE}
