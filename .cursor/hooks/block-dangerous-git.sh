#!/bin/bash

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.command // .tool_input.command // empty')

DANGEROUS_PATTERNS=(
  "git push"
  "git reset --hard"
  "git clean -fd"
  "git clean -f"
  "git branch -D"
  "git checkout \."
  "git restore \."
  "push --force"
  "reset --hard"
)

for pattern in "${DANGEROUS_PATTERNS[@]}"; do
  if echo "$COMMAND" | grep -qE "$pattern"; then
    MSG="BLOCKED: '$COMMAND' matches dangerous pattern '$pattern'. The user has prevented you from doing this."
    echo "$MSG" >&2
    printf '{"permission":"deny","agent_message":%s,"user_message":%s}\n' \
      "$(jq -Rn --arg m "$MSG" '$m')" \
      "$(jq -Rn --arg m "$MSG" '$m')"
    exit 2
  fi
done

echo '{"permission":"allow"}'
exit 0
