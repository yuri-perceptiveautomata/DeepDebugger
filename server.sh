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
    PARAM_LOGFILE="$2"
    shift
    shift
fi

LOG() {
    if [ -n "${PARAM_LOGFILE}" ]
    then
        LOGFILE="${TMPDIR:-${TEMP:-${TMP:-/tmp}}}/${PARAM_LOGFILE}"
        LOCK="${LOGFILE}.lock"
        while ! mkdir -p "${LOCK}" 2>/dev/null
        do
            sleep .005
        done
        echo "[$(date +%s)] server [$$] $1" >> "${LOGFILE}"
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
