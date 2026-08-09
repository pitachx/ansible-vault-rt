# Changelog

All notable changes to the "Ansible Vault RT" extension are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.3.1] - 2026-08-09

### Changed
- **Rekey File**: when the current password isn't already known, a single dialog now collects both the current and new password together, validating the current password in place — the same panel stays open and shows an inline error on a wrong password, instead of closing and reopening a fresh dialog.

## [0.3.0] - 2026-08-09

### Added
- **Rekey File** command (`ansible-vault-rt.rekeyFile`): changes the password of an Ansible Vault file in place on disk. It decrypts the file with its current password (reusing the saved project password automatically when available), then re-encrypts it with a newly entered password, overwriting the file on disk. Available from the Editor Context Menu, File Explorer Context Menu, and Command Palette on Vault files, alongside a confirmation warning before proceeding.

## [0.2.1] - 2026-08-02

### Added
- **Encrypt File** command (`ansible-vault-rt.encryptFile`): encrypts any plaintext file in place on disk with Ansible Vault, after a confirmation prompt.
- **Decrypt File** command (`ansible-vault-rt.decryptFile`): decrypts a Vault file in place on disk, permanently removing the encryption, after a confirmation prompt.

### Changed
- Renamed the `ansible-vault-rt.showEncryptedFile` command to `ansible-vault-rt.closeDecryptedFile`, and its title from "Show Encrypted File" to "Close Decrypted File", to better reflect what it does.

## [0.1.4] - 2026-07-29

### Added
- First market release.

## [0.1.0] - [0.1.3] - 2026-07-27 to 2026-07-28

### Added
- Initial real-time Ansible Vault editing support: decrypt-and-edit-in-place, automatic re-encryption on save, per-project password persistence via OS Keychain, and error recovery for invalid saved passwords.
