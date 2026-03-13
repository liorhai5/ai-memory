# Alternative: Machine-Level Integration

- **Source**: Analysis — OS-level approaches (FSEvents, Endpoint Security, dtrace, etc.)
- **Type**: analysis
- **Accessed**: 2026-03-13

## Findings

### The Idea

Use OS-level mechanisms to capture AI conversations without any IDE-specific integration:
- macOS: FSEvents, Endpoint Security framework, dtrace
- Linux: inotify, eBPF, ptrace
- Cross-platform: File system FUSE overlay

### Approaches Explored

#### 1. FSEvents / inotify (File System Events)

Same as file-watching approach (see 001-005). Watch transcript files for changes. Most practical OS-level approach but really just "file watching with OS APIs."

#### 2. Endpoint Security / eBPF (Process Monitoring)

Monitor process execution: detect when `claude`, `cursor`, `codex` processes start, capture their arguments, track file I/O.

**Problems:**
- Requires elevated privileges (root/admin)
- macOS Endpoint Security needs system extension approval (notarization, user consent)
- Captures process-level events, not conversation content
- Would still need to read transcript files for actual content

#### 3. Network Interception (mitmproxy-style)

Intercept HTTPS traffic to AI API endpoints (api.anthropic.com, etc.) and extract conversations from API calls.

**Problems:**
- Requires CA certificate installation (trust store modification)
- TLS certificate pinning by some clients
- Privacy/security nightmare — intercepting all HTTPS traffic
- Only captures API-level messages, not IDE-level session context
- Wouldn't work for local models (Ollama)

#### 4. Accessibility APIs

macOS Accessibility framework can read UI elements from other applications. Could theoretically extract chat content from IDE windows.

**Problems:**
- Requires accessibility permissions (user consent)
- Brittle — depends on UI element hierarchy of each IDE
- Slow — polling-based, not event-driven
- Cannot extract structured data (just visible text)
- Ethical/privacy concerns

#### 5. FUSE Overlay (Virtual Filesystem)

Create a FUSE filesystem that overlays IDE data directories, intercepting reads/writes to transcript files.

**Problems:**
- Requires FUSE kernel extension (macOS: macFUSE, needs SIP modifications on newer macOS)
- Over-engineered for this problem
- Performance overhead for all file operations in the overlay
- Complex deployment

### What Actually Works at Machine Level

The only machine-level approach that's practical is **file watching** (FSEvents/inotify) — which is just the file-watching alternative with OS APIs instead of polling.

Everything else requires:
- Elevated privileges (ES, eBPF, FUSE)
- Trust store modifications (network interception)
- Special permissions (accessibility)
- Complex deployment (kernel extensions)

### The Fundamental Problem

AI conversations happen INSIDE applications (IDEs). The OS can see:
- Process starts/stops
- File reads/writes
- Network traffic (encrypted)
- UI elements (with permissions)

But it CANNOT see:
- Conversation boundaries
- Session context (workspace, project)
- Which messages are user vs assistant
- When a new conversation starts vs continues

This metadata only exists at the application level. Machine-level integration can capture raw data but cannot provide the structured conversation model that makes the data useful.

### Verdict

Machine-level integration is either:
1. **File watching** (practical but same as Alternative 005)
2. **Overpowered and underprecise** (ES, eBPF, network, FUSE — high privilege, low signal)

The application layer (IDE hooks) is the right level of abstraction for this problem. The OS sees files and processes; we need conversations and turns.
