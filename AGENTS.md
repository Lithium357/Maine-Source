# Development workflow

Develop directly on `main` until the first public launch. Do not create feature branches or pull requests for the owner's pre-launch development. After launch, use branches for risky additions. Keep the GitHub repository synchronized with completed, verified changes.

Never commit API credentials, collected datasets, local preferences, or build outputs. Preserve original downloaded bytes. Keep full-content and metadata-only collection behavior explicit, and retain source/license provenance. Report tests, live checks, and unverified release gates separately.

Every GitHub release must include the complete implemented-source list and API-key/token signup links, including sources mentioned in previous releases. Do not publish a source list containing only changes. Maintain credentialUrl for keyed sources, regenerate the release template with node scripts/release-notes.mjs --update-template, and preserve the managed source section in release notes.
