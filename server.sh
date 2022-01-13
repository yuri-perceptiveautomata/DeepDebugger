#!/bin/sh

SCRIPT_PATH="$(dirname "$0")"
LOG="${SCRIPT_PATH}/log"

PIPE="$1"

if [ "$#" eq "2" ]; then
    printf "%s" "$2" > "${PIPE}"
    exit 0
fi

if [ ! -p "${PIPE}" ]; then
    trap "rm -f "${PIPE}"" EXIT
    mkfifo "${PIPE}"
fi

while true; do
    if read line < "${PIPE}"; then
        if [ "$line" == 'quit' ]; then
            break
        fi
        printf "%s" "$line"
    fi
done
