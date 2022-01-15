#!/bin/sh

PIPE="$1"
shift

if [ "$1" != "-l" ]
then
    MESSAGE="$1"
    shift
fi

if [ "$1" = "-l" ]
then
    LOGFILE="$2"
    shift
    shift
fi

LOG() {
    if [ -n "${LOGFILE}" ]
    then
        LOCK="${LOGFILE}.lock"
        while ! mkdir -p "${LOCK}" 2>/dev/null
        do
            sleep .005
        done
        TIMESTAMP=$(date +"%4Y-%m-%d %H:%M:%S.%N"|cut -b -23)
        echo "[${TIMESTAMP}] server [$$] $1" >> "${LOGFILE}"
        rm -rf "${LOCK}" 2>/dev/null
    fi
}

if [ -n "${MESSAGE}" ]; then
    if [ ! -p "${PIPE}" ]; then
        LOG "${PIPE} does not exist or is not a pipe, exiting"
    else
        LOG "Sending stop signal to ${PIPE} and exiting"
        printf "%s" "${MESSAGE}" > "${PIPE}"
    fi
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
