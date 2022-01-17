#!/bin/sh

CMDLINE=$*

PIPE="$1"
shift

PROCNAME=server

if [ "$1" != "--deep-debugger-log-file" ]
then
    MESSAGE="$1"
    PROCNAME=stopper
    shift
fi

if [ "$1" = "--deep-debugger-log-file" ]
then
    LOGFILE="$2"
    shift
    shift
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

LOG "Logging started"
LOG "Command line: ${CMDLINE}"

if [ -n "${MESSAGE}" ]; then
    lock "${PIPE}"
    if [ ! -p "${PIPE}" ]; then
        LOG "${PIPE} does not exist or is not a pipe, exiting"
    else
        LOG "Sending stop signal to ${PIPE} and exiting"
        printf "%s" "${MESSAGE}" > "${PIPE}"
    fi
    release_lock "${PIPE}"
    exit 0
fi

release_lock "${PIPE}"
lock "${PIPE}"
LOG "Creating ${PIPE}"
trap 'lock ${PIPE}; rm -f ${PIPE}; release_lock ${PIPE}' EXIT
mkfifo "${PIPE}"
release_lock "${PIPE}"

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
