// Ansible Vault's header and first data line are always short (the format wraps
// lines at 80 characters), so only a small prefix needs to be inspected. This
// avoids copying/normalizing the entire file content just to check its header.
const HEADER_CHECK_PREFIX_LENGTH = 4096;

export function isAnsibleVaultContent(content: string): boolean {
  if (!content) {
    return false;
  }

  const prefix = content.slice(0, HEADER_CHECK_PREFIX_LENGTH);
  const normalizedPrefix = prefix.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const lines = normalizedPrefix.split('\n');
  const firstLine = lines[0] ?? '';

  if (!firstLine.startsWith('$ANSIBLE_VAULT')) {
    return false;
  }

  const headerPattern = /^\$ANSIBLE_VAULT;(\d+\.\d+);([A-Za-z0-9_\-]+)$/;
  if (!headerPattern.test(firstLine)) {
    return false;
  }

  if (lines.length < 2) {
    return false;
  }

  const secondLine = lines[1].trim();
  if (!secondLine) {
    return false;
  }

  const base64LikePattern = /^[A-Za-z0-9+/]+={0,2}$/;
  if (!base64LikePattern.test(secondLine)) {
    return false;
  }

  return true;
}

const VAULT_ENVELOPE_DETECTION_PATTERN = /\$ANSIBLE_VAULT;\d+\.\d+;[A-Za-z0-9_\-]+/;

/**
 * Lightweight check for whether `text` contains an Ansible Vault envelope
 * header, used to decide whether to surface the "Decrypt String" menu entry
 * for a given selection. Cheaper than `parseVaultBlock`, and doesn't throw.
 */
export function containsVaultEnvelope(text: string): boolean {
  return VAULT_ENVELOPE_DETECTION_PATTERN.test(text);
}

export interface ParsedVaultBlock {
  variableName?: string;
  envelope: string;
}

const NAMED_VAULT_TAG_PATTERN = /^(.+?):\s*!vault\s*\|\s*$/;
const BARE_VAULT_TAG_PATTERN = /^!vault\s*\|\s*$/;
const VAULT_ENVELOPE_HEADER_PATTERN = /^\$ANSIBLE_VAULT;\d+\.\d+;[A-Za-z0-9_\-]+/;

/**
 * Parses text containing an Ansible Vault `!vault` YAML block — with an
 * optional `name: !vault |` / bare `!vault |` wrapper and arbitrary
 * indentation — back into the raw `$ANSIBLE_VAULT;...` envelope that
 * `Vault#decryptSync` expects, plus the variable name if one was present.
 *
 * Accepts the block with or without the `!vault` wrapper, since a user might
 * select just the envelope lines themselves.
 */
export function parseVaultBlock(text: string): ParsedVaultBlock {
  const normalized = text.replace(/\r\n/g, '\n');
  const rawLines = normalized.split('\n');

  let start = 0;
  let end = rawLines.length;
  while (start < end && rawLines[start].trim() === '') {
    start++;
  }
  while (end > start && rawLines[end - 1].trim() === '') {
    end--;
  }
  const lines = rawLines.slice(start, end);

  if (lines.length === 0) {
    throw new Error('No content to decrypt.');
  }

  let variableName: string | undefined;
  let bodyLines = lines;

  const namedMatch = lines[0].match(NAMED_VAULT_TAG_PATTERN);
  if (namedMatch) {
    variableName = namedMatch[1].trim().replace(/^['"]|['"]$/g, '');
    bodyLines = lines.slice(1);
  } else if (BARE_VAULT_TAG_PATTERN.test(lines[0])) {
    bodyLines = lines.slice(1);
  }

  const envelope = bodyLines
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n');

  if (!VAULT_ENVELOPE_HEADER_PATTERN.test(envelope)) {
    throw new Error('Selected text does not look like an Ansible Vault "!vault" block.');
  }

  return { variableName, envelope };
}
