#!/bin/zsh
# Shared path resolution for doctor and installer. Never reads credential values.
resolve_companion_home() {
  local selected
  if (( $# > 0 )); then
    selected="$1"
  else
    selected="$(defaults read io.github.creeep123.hapicompanion hapiHomeDirectory 2>/dev/null)" || selected="${HAPI_HOME-$HOME/.hapi}"
  fi
  if [[ "$selected" == '~' ]]; then selected="$HOME"
  elif [[ "$selected" == '~/'* ]]; then selected="$HOME/${selected#\~/}"
  fi
  [[ "$selected" == /* ]] || { print -u2 'HAPI configuration directory must be an absolute path'; return 1; }
  print -r -- "$selected"
}
