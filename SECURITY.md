# Security

## Supported versions

Security fixes target the latest 1.x version of DiskMosaic and DiskMosaic Light. Both editions receive fixes to their shared scanning, saved-scan and desktop security boundaries.

## Reporting a vulnerability

Use GitHub's **Report a vulnerability** option under the repository Security tab when available. Avoid placing exploit details, private file paths, saved scans, access tokens or personal files in public issues. If private reporting is unavailable, open an issue asking for a private reporting channel without including sensitive details.

## Security boundaries

The renderer runs with context isolation, sandboxing and Node integration disabled. Network requests and navigation outside the bundled application are blocked. A narrow preload bridge validates requests before forwarding them to the Rust engine. Native dialogs govern file export. Single-item Trash confirmation is enabled by default and configurable; batch Trash always requires confirmation. Saved/history models cannot perform destructive live-file actions.

Normal scans read metadata. Duplicate verification reads candidate file contents; optional local type detection reads bounded prefixes. DiskMosaic makes no network requests, performs no automatic cleanup and includes no telemetry. Reports and snapshots can contain local file names and paths: review them before sharing.

Local history and settings are not encrypted. Filesystem permissions, metadata and notifications depend on the operating system and filesystem. A scan is not a security boundary against another process concurrently modifying the same files.
