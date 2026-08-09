import * as vscode from 'vscode';

export interface PasswordDialogResult {
  password: string;
  remember: boolean;
}

export function showPasswordDialog(
  promptText: string,
  projectName: string,
  initialError?: string
): Promise<PasswordDialogResult | undefined> {
  return new Promise((resolve) => {
    const activeColumn = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : vscode.ViewColumn.One;

    const panel = vscode.window.createWebviewPanel(
      'ansibleVaultPasswordDialog',
      'Ansible Vault RT — Password Required',
      activeColumn || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: false
      }
    );

    let isResolved = false;

    const cleanup = (result?: PasswordDialogResult) => {
      if (!isResolved) {
        isResolved = true;
        resolve(result);
      }
    };

    panel.onDidDispose(() => {
      cleanup(undefined);
    });

    panel.webview.onDidReceiveMessage((message) => {
      if (message.command === 'submit') {
        cleanup({
          password: message.password,
          remember: message.remember
        });
        panel.dispose();
      } else if (message.command === 'cancel') {
        cleanup(undefined);
        panel.dispose();
      }
    });

    const errorHtml = initialError
      ? `<div class="error-banner">${escapeHtml(initialError)}</div>`
      : '';

    panel.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ansible Vault Password</title>
  <style>
    *, *:before, *:after {
      box-sizing: border-box;
    }
    html, body {
      height: 100%;
      margin: 0;
      padding: 0;
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
      font-size: var(--vscode-font-size, 13px);
      color: var(--vscode-foreground, #cccccc);
      background-color: var(--vscode-editor-background, #1e1e1e);
      display: flex;
      justify-content: center;
      align-items: center;
      user-select: none;
    }
    .modal-card {
      background-color: var(--vscode-sideBar-background, #252526);
      border: 1px solid var(--vscode-widget-border, rgba(255, 255, 255, 0.12));
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
      border-radius: 6px;
      padding: 24px;
      width: 100%;
      max-width: 440px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .title-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .icon {
      font-size: 18px;
    }
    .title {
      font-weight: 600;
      font-size: 15px;
      color: var(--vscode-editor-foreground, #ffffff);
    }
    .prompt {
      color: var(--vscode-descriptionForeground, #aaaaaa);
      font-size: 12px;
      line-height: 1.4;
    }
    .error-banner {
      background-color: var(--vscode-inputValidation-errorBackground, #5a1d1d);
      color: var(--vscode-inputValidation-errorForeground, #ffffff);
      border: 1px solid var(--vscode-inputValidation-errorBorder, #be1100);
      padding: 8px 12px;
      border-radius: 4px;
      font-size: 12px;
    }
    .input-group {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    input[type="password"] {
      background-color: var(--vscode-input-background, #3c3c3c);
      color: var(--vscode-input-foreground, #cccccc);
      border: 1px solid var(--vscode-input-border, rgba(255, 255, 255, 0.15));
      border-radius: 4px;
      padding: 9px 12px;
      font-size: 13px;
      font-family: inherit;
      outline: none;
      width: 100%;
    }
    input[type="password"]:focus {
      border-color: var(--vscode-focusBorder, #007acc);
    }
    .checkbox-container {
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      font-size: 12px;
      color: var(--vscode-foreground, #cccccc);
      margin-top: 2px;
    }
    input[type="checkbox"] {
      cursor: pointer;
      accent-color: var(--vscode-button-background, #0e639c);
      width: 15px;
      height: 15px;
      margin: 0;
    }
    .button-group {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      margin-top: 6px;
    }
    button {
      padding: 8px 20px;
      border-radius: 4px;
      font-family: inherit;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      outline: none;
      border: 1px solid transparent;
      transition: background-color 0.15s ease;
    }
    button.btn-primary {
      background-color: var(--vscode-button-background, #0e639c);
      color: var(--vscode-button-foreground, #ffffff);
    }
    button.btn-primary:hover {
      background-color: var(--vscode-button-hoverBackground, #1177bb);
    }
    button.btn-secondary {
      background-color: var(--vscode-button-secondaryBackground, rgba(255, 255, 255, 0.08));
      color: var(--vscode-button-secondaryForeground, #ffffff);
      border: 1px solid var(--vscode-widget-border, rgba(255, 255, 255, 0.1));
    }
    button.btn-secondary:hover {
      background-color: var(--vscode-button-secondaryHoverBackground, rgba(255, 255, 255, 0.15));
    }
  </style>
</head>
<body>
  <div class="modal-card">
    <div class="title-row">
      <span class="icon">🔒</span>
      <span class="title">Ansible Vault RT</span>
    </div>
    <div class="prompt">${escapeHtml(promptText)}</div>

    ${errorHtml}

    <div class="input-group">
      <input type="password" id="passwordInput" placeholder="Vault Password" autofocus />
      <label class="checkbox-container">
        <input type="checkbox" id="rememberCheckbox" />
        <span>Save password for project <strong>${escapeHtml(projectName)}</strong></span>
      </label>
    </div>

    <div class="button-group">
      <button class="btn-secondary" id="cancelBtn">Cancel</button>
      <button class="btn-primary" id="okBtn">OK</button>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const passwordInput = document.getElementById('passwordInput');
    const rememberCheckbox = document.getElementById('rememberCheckbox');
    const okBtn = document.getElementById('okBtn');
    const cancelBtn = document.getElementById('cancelBtn');

    window.addEventListener('DOMContentLoaded', () => {
      passwordInput.focus();
    });

    function submit() {
      const password = passwordInput.value;
      if (!password) {
        passwordInput.style.borderColor = 'var(--vscode-inputValidation-errorBorder, #be1100)';
        return;
      }
      vscode.postMessage({
        command: 'submit',
        password: password,
        remember: rememberCheckbox.checked
      });
    }

    function cancel() {
      vscode.postMessage({ command: 'cancel' });
    }

    okBtn.addEventListener('click', submit);
    cancelBtn.addEventListener('click', cancel);

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
      }
    });
  </script>
</body>
</html>`;
  });
}

export interface RekeyDialogResult {
  currentPassword: string;
  newPassword: string;
  remember: boolean;
}

export interface RekeyValidationResult {
  success: boolean;
  errorMessage?: string;
}

/**
 * Shows a single dialog with both the current and new Vault password fields
 * for the "Rekey File" flow. The current password is validated in place: on
 * submit, `onValidateCurrentPassword` is invoked (e.g. to attempt a decrypt),
 * and if it fails the same panel stays open showing the error, rather than
 * closing and reopening a fresh dialog like the retry loop used elsewhere.
 */
export function showRekeyPasswordDialog(
  projectName: string,
  onValidateCurrentPassword: (currentPassword: string) => Promise<RekeyValidationResult>
): Promise<RekeyDialogResult | undefined> {
  return new Promise((resolve) => {
    const activeColumn = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : vscode.ViewColumn.One;

    const panel = vscode.window.createWebviewPanel(
      'ansibleVaultRekeyDialog',
      'Ansible Vault RT — Rekey File',
      activeColumn || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: false
      }
    );

    let isResolved = false;

    const cleanup = (result?: RekeyDialogResult) => {
      if (!isResolved) {
        isResolved = true;
        resolve(result);
      }
    };

    panel.onDidDispose(() => {
      cleanup(undefined);
    });

    panel.webview.onDidReceiveMessage(async (message) => {
      if (message.command === 'submit') {
        const validation = await onValidateCurrentPassword(message.currentPassword);

        if (validation.success) {
          cleanup({
            currentPassword: message.currentPassword,
            newPassword: message.newPassword,
            remember: message.remember
          });
          panel.dispose();
        } else {
          panel.webview.postMessage({
            command: 'validationError',
            message: validation.errorMessage || 'Invalid password or corrupted vault file. Please try again.'
          });
        }
      } else if (message.command === 'cancel') {
        cleanup(undefined);
        panel.dispose();
      }
    });

    panel.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ansible Vault Rekey</title>
  <style>
    *, *:before, *:after {
      box-sizing: border-box;
    }
    html, body {
      height: 100%;
      margin: 0;
      padding: 0;
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
      font-size: var(--vscode-font-size, 13px);
      color: var(--vscode-foreground, #cccccc);
      background-color: var(--vscode-editor-background, #1e1e1e);
      display: flex;
      justify-content: center;
      align-items: center;
      user-select: none;
    }
    .modal-card {
      background-color: var(--vscode-sideBar-background, #252526);
      border: 1px solid var(--vscode-widget-border, rgba(255, 255, 255, 0.12));
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
      border-radius: 6px;
      padding: 24px;
      width: 100%;
      max-width: 440px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .title-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .icon {
      font-size: 18px;
    }
    .title {
      font-weight: 600;
      font-size: 15px;
      color: var(--vscode-editor-foreground, #ffffff);
    }
    .prompt {
      color: var(--vscode-descriptionForeground, #aaaaaa);
      font-size: 12px;
      line-height: 1.4;
    }
    .error-banner {
      background-color: var(--vscode-inputValidation-errorBackground, #5a1d1d);
      color: var(--vscode-inputValidation-errorForeground, #ffffff);
      border: 1px solid var(--vscode-inputValidation-errorBorder, #be1100);
      padding: 8px 12px;
      border-radius: 4px;
      font-size: 12px;
      display: none;
    }
    .error-banner.visible {
      display: block;
    }
    .field-group {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .field-label {
      font-size: 11px;
      color: var(--vscode-descriptionForeground, #aaaaaa);
    }
    .input-group {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    input[type="password"] {
      background-color: var(--vscode-input-background, #3c3c3c);
      color: var(--vscode-input-foreground, #cccccc);
      border: 1px solid var(--vscode-input-border, rgba(255, 255, 255, 0.15));
      border-radius: 4px;
      padding: 9px 12px;
      font-size: 13px;
      font-family: inherit;
      outline: none;
      width: 100%;
    }
    input[type="password"]:focus {
      border-color: var(--vscode-focusBorder, #007acc);
    }
    input[type="password"]:disabled {
      opacity: 0.6;
    }
    .checkbox-container {
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      font-size: 12px;
      color: var(--vscode-foreground, #cccccc);
      margin-top: 2px;
    }
    input[type="checkbox"] {
      cursor: pointer;
      accent-color: var(--vscode-button-background, #0e639c);
      width: 15px;
      height: 15px;
      margin: 0;
    }
    .button-group {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      margin-top: 6px;
    }
    button {
      padding: 8px 20px;
      border-radius: 4px;
      font-family: inherit;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      outline: none;
      border: 1px solid transparent;
      transition: background-color 0.15s ease;
    }
    button:disabled {
      opacity: 0.6;
      cursor: default;
    }
    button.btn-primary {
      background-color: var(--vscode-button-background, #0e639c);
      color: var(--vscode-button-foreground, #ffffff);
    }
    button.btn-primary:hover:not(:disabled) {
      background-color: var(--vscode-button-hoverBackground, #1177bb);
    }
    button.btn-secondary {
      background-color: var(--vscode-button-secondaryBackground, rgba(255, 255, 255, 0.08));
      color: var(--vscode-button-secondaryForeground, #ffffff);
      border: 1px solid var(--vscode-widget-border, rgba(255, 255, 255, 0.1));
    }
    button.btn-secondary:hover:not(:disabled) {
      background-color: var(--vscode-button-secondaryHoverBackground, rgba(255, 255, 255, 0.15));
    }
  </style>
</head>
<body>
  <div class="modal-card">
    <div class="title-row">
      <span class="icon">🔑</span>
      <span class="title">Ansible Vault RT</span>
    </div>
    <div class="prompt">Enter the current and new Ansible Vault passwords to rekey this file.</div>

    <div class="error-banner" id="errorBanner"></div>

    <div class="input-group">
      <div class="field-group">
        <span class="field-label">Current Password</span>
        <input type="password" id="currentPasswordInput" placeholder="Current Vault Password" autofocus />
      </div>
      <div class="field-group">
        <span class="field-label">New Password</span>
        <input type="password" id="newPasswordInput" placeholder="New Vault Password" />
      </div>
      <label class="checkbox-container">
        <input type="checkbox" id="rememberCheckbox" />
        <span>Save new password for project <strong>${escapeHtml(projectName)}</strong></span>
      </label>
    </div>

    <div class="button-group">
      <button class="btn-secondary" id="cancelBtn">Cancel</button>
      <button class="btn-primary" id="okBtn">Rekey</button>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const currentPasswordInput = document.getElementById('currentPasswordInput');
    const newPasswordInput = document.getElementById('newPasswordInput');
    const rememberCheckbox = document.getElementById('rememberCheckbox');
    const okBtn = document.getElementById('okBtn');
    const cancelBtn = document.getElementById('cancelBtn');
    const errorBanner = document.getElementById('errorBanner');

    let isSubmitting = false;

    window.addEventListener('DOMContentLoaded', () => {
      currentPasswordInput.focus();
    });

    function setSubmitting(submitting) {
      isSubmitting = submitting;
      currentPasswordInput.disabled = submitting;
      newPasswordInput.disabled = submitting;
      rememberCheckbox.disabled = submitting;
      okBtn.disabled = submitting;
      cancelBtn.disabled = submitting;
    }

    function showError(message) {
      errorBanner.textContent = message;
      errorBanner.classList.add('visible');
    }

    function clearError() {
      errorBanner.classList.remove('visible');
      errorBanner.textContent = '';
    }

    function submit() {
      if (isSubmitting) {
        return;
      }

      const currentPassword = currentPasswordInput.value;
      const newPassword = newPasswordInput.value;

      if (!currentPassword) {
        currentPasswordInput.style.borderColor = 'var(--vscode-inputValidation-errorBorder, #be1100)';
        return;
      }
      if (!newPassword) {
        newPasswordInput.style.borderColor = 'var(--vscode-inputValidation-errorBorder, #be1100)';
        return;
      }

      clearError();
      setSubmitting(true);

      vscode.postMessage({
        command: 'submit',
        currentPassword: currentPassword,
        newPassword: newPassword,
        remember: rememberCheckbox.checked
      });
    }

    function cancel() {
      vscode.postMessage({ command: 'cancel' });
    }

    okBtn.addEventListener('click', submit);
    cancelBtn.addEventListener('click', cancel);

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
      }
    });

    window.addEventListener('message', (event) => {
      const message = event.data;
      if (message.command === 'validationError') {
        setSubmitting(false);
        showError(message.message);
        currentPasswordInput.style.borderColor = 'var(--vscode-inputValidation-errorBorder, #be1100)';
        currentPasswordInput.focus();
        currentPasswordInput.select();
      }
    });
  </script>
</body>
</html>`;
  });
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
