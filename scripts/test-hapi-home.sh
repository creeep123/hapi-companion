set -eu
source scripts/hapi-home.sh
defaults() { if [[ ${FAKE_SAVED+x} ]]; then print -r -- "$FAKE_SAVED"; else return 1; fi }
assert_eq() { [[ "$1" == "$2" ]] || { print -u2 'resolution mismatch'; exit 1; } }
unset HAPI_HOME FAKE_SAVED
assert_eq "$(resolve_companion_home)" "$HOME/.hapi"
export HAPI_HOME=/tmp/env-hapi
assert_eq "$(resolve_companion_home)" /tmp/env-hapi
FAKE_SAVED=/tmp/saved-hapi
assert_eq "$(resolve_companion_home)" /tmp/saved-hapi
assert_eq "$(resolve_companion_home /tmp/explicit-hapi)" /tmp/explicit-hapi
assert_eq "$(resolve_companion_home '~/with spaces')" "$HOME/with spaces"
if resolve_companion_home relative >/dev/null 2>&1; then exit 1; fi
if resolve_companion_home '' >/dev/null 2>&1; then exit 1; fi
print '7 shell path checks passed'
