#!/usr/bin/env bash
# Remove this installation and its command link, keeping user configuration and sessions.
set -euo pipefail

if (($# != 0)); then
    echo "Usage: bash uninstall.sh" >&2
    exit 1
fi
prefix=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
marker="$prefix/.installed-command"
if [[ ! -L "$marker" || "$prefix" == / || "$prefix" == "$HOME" ]]; then
    echo "Not a recognized installed company-pi directory: $prefix" >&2
    exit 1
fi
command_link=$(readlink -- "$marker")
if [[ "$command_link" != /* ]]; then
    echo "Invalid installation command record." >&2
    exit 1
fi
if [[ -L "$command_link" && $(readlink -f -- "$command_link") == "$prefix/bin/pi" ]]; then
    rm -- "$command_link"
elif [[ -e "$command_link" || -L "$command_link" ]]; then
    echo "Command changed since installation; leaving it untouched: $command_link" >&2
fi
rm -rf -- "$prefix"
echo "Removed: $prefix"
echo "User configuration and sessions were kept."
