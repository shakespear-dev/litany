#!/bin/sh
# Play the lines script/vox-render.ts wrote (or the spike's, laid out the same), with what each says.
#   VOX_DIR=<dir> sh vox-listen.sh [mars|cogitator|forge|claude]   every line once (no argument: every voice)
#   VOX_DIR=<dir> sh vox-listen.sh takes [voice]                    each line three times, a different take each time
[ -n "$VOX_DIR" ] || { echo 'set VOX_DIR to a vox-render.ts out dir' >&2; exit 1; }
cd "$VOX_DIR" || exit 1
play() { if command -v afplay >/dev/null; then afplay "$1"; else pw-play "$1" 2>/dev/null || paplay "$1" 2>/dev/null || aplay -q "$1"; fi; }
said() { awk -F '\t' -v id="$1" '$1 == id { print $2 }' lines.tsv; }
line() { id=${1%.wav}; id=${id%.take?}; printf '%-34s "%s"\n' "$1" "$(said "${id#*-}")"; }

case "$1" in
  takes)
    for f in takes/${2:+$2-}*.take1.wav; do
      for n in 1 2 3; do g=${f%.take1.wav}.take$n.wav; line "${g#takes/}"; play "$g"; sleep 0.3; done
      sleep 0.6
    done ;;
  *)
    for f in ${1:+$1-}*.wav; do
      case "$f" in ctx-*|raw-*) continue ;; esac
      line "$f"; play "$f"; sleep 0.4
    done ;;
esac
