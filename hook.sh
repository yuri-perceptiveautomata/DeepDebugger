#!/bin/sh

HOOK_QUEUE=${DEEPDEBUGGER_LAUNCHER_QUEUE}.${DEEPDEBUGGER_SESSION_ID}
BASE64=base64 -w 0
PARAM_TYPE="\"type\": \"\""
PARAM_CWD="\"cwd\": \"$(printf "%s" "${PWD}" | "${BASE64}")\""
PARAM_CMDLINE="\"cmdline\": \"$(printf "%s %s" "$0" "$*" | "${BASE64}")\""
PARAM_HOOKPIPE="\"deepDbgHookPipe\": \"${HOOK_QUEUE}\""
PARAM_ENV_CONT=`printenv | while IFS= read -r line; do (printf "%s" "${line}" | "${BASE64}"); printf "-"; done`
PARAM_ENV="\"environment\": \"${PARAM_ENV_CONT}\""

PARAMS_JSON="{${PARAM_TYPE},${PARAM_CWD},${PARAM_CMDLINE},${PARAM_HOOKPIPE},${PARAM_ENV}}"

printf "start|%s" "${PARAMS_JSON}" | nc -UN ${DEEPDEBUGGER_LAUNCHER_QUEUE}
nc -Ul ${HOOK_QUEUE}
