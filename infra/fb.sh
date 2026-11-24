#!/usr/bin/env bash
# Runs firebase-tools@15 with a JDK >= 21 (the emulators refuse older Java).
# If the default `java` is too old, picks the newest /usr/lib/jvm/java-NN* with NN >= 21.
set -euo pipefail
ver() { "$1" -version 2>&1 | awk -F'"' '/version/ {split($2, a, "."); print a[1]; exit}'; }
if ! command -v java >/dev/null || [ "$(ver java)" -lt 21 ]; then
  for d in $(ls -d /usr/lib/jvm/java-[0-9]* /Library/Java/JavaVirtualMachines/*/Contents/Home 2>/dev/null | sort -V -r); do
    if [ -x "$d/bin/java" ] && [ "$(ver "$d/bin/java")" -ge 21 ]; then
      export JAVA_HOME="$d" PATH="$d/bin:$PATH"
      break
    fi
  done
fi
exec npx -y firebase-tools@15 "$@"
