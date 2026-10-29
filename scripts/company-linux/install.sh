#!/usr/bin/env bash
# Install an offline Linux distribution at a chosen prefix and expose its pi command.
set -euo pipefail

usage() {
    cat <<'USAGE'
Usage: bash install.sh [--prefix <directory>] [--bin-dir <directory>]

Defaults:
  --prefix   $HOME/.local/share/company-pi
  --bin-dir  $HOME/.local/bin

The package includes Node.js and dependencies. Installation does not use the network.
Existing install directories and commands are never overwritten.
USAGE
}

prefix="$HOME/.local/share/company-pi"
bin_dir="$HOME/.local/bin"
while (($#)); do
    case "$1" in
        --prefix|--bin-dir)
            if (($# < 2)) || [[ -z "$2" ]]; then
                echo "Missing value for $1" >&2
                exit 1
            fi
            if [[ "$1" == --prefix ]]; then prefix=$2; else bin_dir=$2; fi
            shift 2
            ;;
        --help|-h) usage; exit 0 ;;
        *) echo "Unknown option: $1" >&2; usage >&2; exit 1 ;;
    esac
done

if [[ $(uname -s) != Linux ]]; then
    echo "This package requires Linux." >&2
    exit 1
fi
if [[ "$prefix" != /* || "$bin_dir" != /* ]]; then
    echo "--prefix and --bin-dir must be absolute paths." >&2
    exit 1
fi
prefix=$(realpath -m -- "$prefix")
bin_dir=$(realpath -m -- "$bin_dir")
source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
case "$prefix/" in
    "$source_dir/"*) echo "Install outside the extracted package directory." >&2; exit 1 ;;
esac
case "$bin_dir/" in
    "$prefix/"*) echo "--bin-dir must be outside --prefix." >&2; exit 1 ;;
esac
command_link="$bin_dir/pi"
if [[ -e "$prefix" || -L "$prefix" ]]; then
    echo "Install directory already exists: $prefix" >&2
    exit 1
fi
if [[ -e "$command_link" || -L "$command_link" ]]; then
    echo "Command already exists: $command_link" >&2
    exit 1
fi

(cd -- "$source_dir" && sha256sum --check --quiet SHA256SUMS)
"$source_dir/runtime/bin/node" --version
mkdir -p -- "$(dirname -- "$prefix")" "$bin_dir"
staging=$(mktemp -d "$(dirname -- "$prefix")/.company-pi-install.XXXXXXXX")
trap 'rm -rf -- "$staging"' EXIT
cp -a -- "$source_dir/." "$staging/"
PI_OFFLINE=1 PI_TELEMETRY=0 "$staging/bin/pi" --version
mv -T --no-clobber -- "$staging" "$prefix"
if [[ -d "$staging" ]]; then
    echo "Install directory was created by another process: $prefix" >&2
    exit 1
fi
ln -s -- "$prefix/bin/pi" "$command_link"
echo "Installed: $prefix"
echo "Command: $command_link"
case ":$PATH:" in
    *":$bin_dir:"*) ;;
    *) printf 'Add this directory to PATH: %s\n' "$bin_dir" ;;
esac
echo "Run pi from the project directory you want it to work in."
