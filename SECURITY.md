# Security

Maine Source is pre-release software. There is no stable 1.0 release yet.

Do not post API keys, private datasets, or exploit details in a public issue. Use GitHub's **Security → Report a vulnerability** when private reporting is available. If that option is unavailable, open a public issue asking for a private contact without including sensitive details. Maintainers must enable private vulnerability reporting before the public launch.

The app renders collected text as escaped text, never as executable HTML. Downloads are retained as files and revealed in Explorer rather than executed. The renderer has no Node integration, runs with context isolation and sandboxing, and has a restrictive content security policy. The main process validates IPC senders and restricts outbound opening to HTTPS URLs. Archives are inspected without extracting paths or running source files. PDF/HTML extraction runs in a bounded subprocess.

Credentials are encrypted with the OS when remembered, or held in memory for the session. They are not included in recipes. Source-provided metadata is untrusted; users should inspect datasets before redistribution. Do not open downloaded source files in tools configured to automatically execute them.

Release review includes runtime dependency auditing, hostile-content fixtures, traversal/symlink rejection, redirect credential handling, and log redaction. A clean dependency audit is not a guarantee that the application has no vulnerabilities. The owner has chosen unsigned Windows distribution because code signing costs money, and no independent third-party security audit is planned. Maintainer security checks continue. Verification and remaining limitations are tracked in [the release checklist](docs/release-readiness.md).

The Python API launches a private child process over stdin/stdout; it opens no HTTP service. Current GUI/API processes take a shared workspace lease to prevent simultaneous writers. A crash leaves a resumable interrupted run and a lease that can be reclaimed once its owning process is dead. Close older GUI versions before using their workspace through the API.

Portable credential JSON is an explicit plaintext export, separate from the OS-encrypted GUI vault. Imports validate the complete bundle and do not partially apply malformed files. The GUI sends no raw keys back to its renderer during import/export. The API sends keys through stdin, holds them in memory, and does not automatically read the GUI vault. Keep transferred JSON private and out of source control. RunAsNode remains enabled for extraction and the packaged API backend.
