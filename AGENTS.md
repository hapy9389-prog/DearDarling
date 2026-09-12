# DearDarling: secret handling

These instructions apply to every task, including after /clear. Never include real
secret values in prompts, tool output, logs, diffs, screenshots, or reports.

## Protected information
- Real .env files and their backups; DATABASE_URL credentials; Cognito client
  secrets; SESSION_TOKEN_ENCRYPTION_KEY; AWS credentials; SSH private keys;
  passwords, verification codes, tokens, and session cookies.
- .gitignore prevents accidental commits, not disclosure through tool output.
- Do not open protected files with Read/Edit/Write or print them with cat, grep,
  sed, diff, environment dumps, debug logging, or equivalent Python/Node code.
- Never bypass a denied file read with a different tool, path, encoding, or copy.
- Read configuration source code and non-secret templates to understand settings.

## Authorized secret maintenance
- Use reviewed scripts that consume secrets internally and report only required
  key names and existence/equality/success flags. Do not return values, fragments,
  encoded values, or hashes. Review script source and error paths before execution.
- Secret-producing AWS responses must go directly to protected files without
  appearing in tool output. Capture and sanitize stderr as well as stdout.
- Create a dedicated temporary directory outside the repository with mode 0700
  and files with mode 0600 before collecting sensitive output; use umask 077.
- Do not pass secret values as command-line arguments or use shell tracing.
- Ask the user to enter passwords and verification codes through hidden local
  terminal input, not chat. Never request a screenshot containing a secret.
- Preserve unrelated settings. Compare settings internally; print only equality.
- Keep recovery material protected until new settings are durably saved and
  verified. Then remove only this task's temporary secret files and stale copies.
- Tests use fake credentials and isolated state; never copy real .env, *.pem,
  or *.local.json files into a test workspace.

## Rotation and incident handling
- Stop new authentication sessions before replacing a token encryption key.
  Recheck dependent encrypted data immediately before replacement. Do not rotate
  blindly if encrypted rows exist. Rotate before testing a new login.
- Preserve Cognito Pool/Client IDs when supported: add a secret, update config,
  verify the new secret, remove the exposed secret, and verify removal.
- Update DB credentials and application config together. Do not automatically
  roll back to an exposed password. Report incomplete revocation as incomplete.
- If disclosure occurs, stop the affected action and report secret categories and
  locations only; do not repeat values or claim external compromise without evidence.

## Enforcement limits
- .Codex/settings.json adds file-tool read restrictions. Check the loaded rules
  in /permissions before secret maintenance; use dummy values to verify blocking.
- These rules are not OS isolation and do not guarantee protection against every
  subprocess. Never claim settings are active or tested merely because files exist.
- No secret values or incident transcripts belong in these instruction files.
