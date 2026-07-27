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
