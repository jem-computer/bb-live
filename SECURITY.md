# Security

Report vulnerabilities privately through [GitHub security advisories](https://github.com/jem-computer/bb-live/security/advisories/new). Don't include credentials, transcripts, or private workspace data in public issues. If private reporting is unavailable, open an issue asking for a private reporting channel without disclosing the vulnerability.

BB Live is an experimental, full-trust BB plugin. Install it only on a BB instance you control. It can read workspace context and start, steer, queue, and stop BB agent work. The current design supports one active voice session per installation, within BB's authenticated access boundary; it does not provide separate user isolation.

Set the OpenAI API key in BB's secret settings. Never put it in source files, environment examples, screenshots, issues, or transcripts. Audio is sent to OpenAI for the voice session; text and workspace context are sent for intent interpretation. The plugin does not persist raw audio. Text retention defaults to 30 days and can be disabled in Preferences. See the README for the implemented controls and VERIFICATION.md for remaining acceptance work.

If a credential is published, revoke or rotate it first, then remove it from current files and Git history. Deleting a file in a later commit does not remove the exposed credential from earlier commits.

CI scans all fetched Git history with Gitleaks. Before publishing, also inspect untracked files, the proposed Git diff, archives, and screenshots. Automated scans cannot prove that a repository contains no sensitive information.
