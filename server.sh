#!/bin/sh

LOG() {
    echo "$1" >> /tmp/server.log
}

PIPE="$1"

if [ $# = '2' ]; then
    LOG "Sending stop signal to ${PIPE} and exiting"
    printf "%s" "$2" > "${PIPE}"
    exit 0
fi

if [ ! -p "${PIPE}" ]; then
    LOG "Creating ${PIPE}"
    trap 'rm -f ${PIPE}' EXIT
    mkfifo "${PIPE}"
fi

while true; do
    LOG "Waiting on ${PIPE}"
    read -r line < "${PIPE}"
    if [ "$line" = 'stopped' ]; then
        LOG "Stop signal received, exiting"
        break
    fi
    LOG "Printing start|${line}|end"
    printf "%s" "start|${line}|end"
done
