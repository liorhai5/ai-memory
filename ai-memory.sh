#!/usr/bin/env bash
# ai-memory — Machine-level AI memory manager
# Manages ~/.ai-memory/ (shared memory, skills, data)

set -euo pipefail

AI_MEMORY_DIR="$HOME/.ai-memory"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATES_DIR="$SCRIPT_DIR/templates"

# --- Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# --- Helpers ---

usage() {
  cat <<EOF
${CYAN}ai-memory${NC} — Machine-level AI memory manager

${YELLOW}Usage:${NC}
  ai-memory init [--force]       Create ~/.ai-memory/ with templates
  ai-memory soul [edit]          Show SOUL.md (edit: open in \$EDITOR)
  ai-memory memory [edit]        Show MEMORY.md (edit: open in \$EDITOR)
  ai-memory data list            List data/ files
  ai-memory data add <file>      Copy a file to data/
  ai-memory data note "text"     Append to data/notes.md
  ai-memory skill list           List shared skills
  ai-memory skill add <file>     Copy a skill YAML to skills/

${YELLOW}Paths:${NC}
  Machine memory:  ~/.ai-memory/
  Project memory:  ai-memory/ (managed by Cursor, not this CLI)
EOF
}

require_init() {
  if [ ! -d "$AI_MEMORY_DIR" ]; then
    echo -e "${RED}Error:${NC} ~/.ai-memory/ does not exist. Run ${CYAN}ai-memory init${NC} first."
    exit 1
  fi
}

show_or_edit() {
  local file="$1"
  local name="$2"
  require_init
  if [ ! -f "$file" ]; then
    echo -e "${RED}Error:${NC} $name not found at $file"
    exit 1
  fi
  if [ "${3:-}" = "edit" ]; then
    ${EDITOR:-vi} "$file"
  else
    cat "$file"
  fi
}

# --- Commands ---

cmd_init() {
  local force=false
  if [ "${1:-}" = "--force" ]; then
    force=true
  fi

  if [ -d "$AI_MEMORY_DIR" ] && [ "$force" = false ]; then
    echo -e "${YELLOW}Warning:${NC} ~/.ai-memory/ already exists."
    echo ""
    ls -la "$AI_MEMORY_DIR"/
    echo ""
    read -rp "Override existing files? [y/N] " answer
    case "$answer" in
      [yY]|[yY][eE][sS]) ;;
      *) echo "Aborted."; exit 0 ;;
    esac
  fi

  echo -e "${CYAN}Initializing ~/.ai-memory/...${NC}"

  # Create directories
  mkdir -p "$AI_MEMORY_DIR"/{data,skills}

  # Copy templates
  cp "$TEMPLATES_DIR/SOUL.md" "$AI_MEMORY_DIR/SOUL.md"
  cp "$TEMPLATES_DIR/MEMORY.md" "$AI_MEMORY_DIR/MEMORY.md"

  # Copy starter skills
  for skill in "$TEMPLATES_DIR/skills/"*.yaml; do
    [ -f "$skill" ] && cp "$skill" "$AI_MEMORY_DIR/skills/"
  done

  echo ""
  echo -e "${GREEN}✓${NC} Created ~/.ai-memory/"
  echo ""
  echo "  SOUL.md        — Your identity (edit this first!)"
  echo "  MEMORY.md      — Shared cross-project memory"
  echo "  data/          — Knowledge files"
  echo "  skills/        — Workflow skills"
  echo ""
  echo -e "Next: ${CYAN}ai-memory soul edit${NC} to set up your identity."
}

cmd_soul() {
  show_or_edit "$AI_MEMORY_DIR/SOUL.md" "SOUL.md" "${1:-}"
}

cmd_memory() {
  show_or_edit "$AI_MEMORY_DIR/MEMORY.md" "MEMORY.md" "${1:-}"
}

cmd_data() {
  require_init
  local subcmd="${1:-}"
  shift 2>/dev/null || true

  case "$subcmd" in
    list)
      echo -e "${CYAN}~/.ai-memory/data/${NC}"
      if [ -d "$AI_MEMORY_DIR/data" ] && [ "$(ls -A "$AI_MEMORY_DIR/data" 2>/dev/null)" ]; then
        ls -1 "$AI_MEMORY_DIR/data/"
      else
        echo "(empty)"
      fi
      ;;
    add)
      local file="${1:-}"
      if [ -z "$file" ] || [ ! -f "$file" ]; then
        echo -e "${RED}Error:${NC} Provide a valid file path. Usage: ai-memory data add <file>"
        exit 1
      fi
      cp "$file" "$AI_MEMORY_DIR/data/"
      echo -e "${GREEN}✓${NC} Added $(basename "$file") to ~/.ai-memory/data/"
      ;;
    note)
      local text="${1:-}"
      if [ -z "$text" ]; then
        echo -e "${RED}Error:${NC} Provide note text. Usage: ai-memory data note \"text\""
        exit 1
      fi
      local date
      date=$(date +%Y-%m-%d)
      echo "- [$date] $text" >> "$AI_MEMORY_DIR/data/notes.md"
      echo -e "${GREEN}✓${NC} Note added to ~/.ai-memory/data/notes.md"
      ;;
    *)
      echo -e "${RED}Error:${NC} Unknown data command '$subcmd'"
      echo "Usage: ai-memory data [list|add|note]"
      exit 1
      ;;
  esac
}

cmd_skill() {
  require_init
  local subcmd="${1:-}"
  shift 2>/dev/null || true

  case "$subcmd" in
    list)
      echo -e "${CYAN}~/.ai-memory/skills/${NC}"
      if [ -d "$AI_MEMORY_DIR/skills" ] && [ "$(ls -A "$AI_MEMORY_DIR/skills" 2>/dev/null)" ]; then
        for skill in "$AI_MEMORY_DIR/skills/"*.yaml; do
          [ -f "$skill" ] || continue
          local name desc
          name=$(grep '^name:' "$skill" | head -1 | sed 's/name: *//')
          # Handle both inline and multi-line YAML descriptions
          desc=$(grep '^description:' "$skill" | head -1 | sed 's/description: *//')
          if [ "$desc" = "|" ] || [ -z "$desc" ]; then
            # Multi-line: grab the first indented line after description:
            desc=$(awk '/^description:/{getline; gsub(/^[[:space:]]+/, ""); print; exit}' "$skill")
          fi
          printf "  %-24s %s\n" "$name" "$desc"
        done
      else
        echo "(no skills installed)"
      fi
      ;;
    add)
      local file="${1:-}"
      if [ -z "$file" ] || [ ! -f "$file" ]; then
        echo -e "${RED}Error:${NC} Provide a valid YAML file. Usage: ai-memory skill add <file>"
        exit 1
      fi
      if [[ "$file" != *.yaml ]]; then
        echo -e "${RED}Error:${NC} Skills must be .yaml files."
        exit 1
      fi
      cp "$file" "$AI_MEMORY_DIR/skills/"
      echo -e "${GREEN}✓${NC} Added $(basename "$file") to ~/.ai-memory/skills/"
      ;;
    *)
      echo -e "${RED}Error:${NC} Unknown skill command '$subcmd'"
      echo "Usage: ai-memory skill [list|add]"
      exit 1
      ;;
  esac
}

# --- Main ---

cmd="${1:-}"
shift 2>/dev/null || true

case "$cmd" in
  init)    cmd_init "$@" ;;
  soul)    cmd_soul "$@" ;;
  memory)  cmd_memory "$@" ;;
  data)    cmd_data "$@" ;;
  skill)   cmd_skill "$@" ;;
  help|-h|--help) usage ;;
  "")      usage ;;
  *)
    echo -e "${RED}Error:${NC} Unknown command '$cmd'"
    echo ""
    usage
    exit 1
    ;;
esac
