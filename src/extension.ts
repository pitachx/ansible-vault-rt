import * as vscode from 'vscode';
import * as fs from 'fs';
import { Vault } from 'ansible-vault';
import { VaultFileSystemProvider } from './vaultFileSystemProvider';
import { PasswordManager } from './passwordManager';
import { showPasswordDialog, showRekeyPasswordDialog, showEncryptStringDialog, showDecryptStringDialog } from './passwordDialog';
import { isAnsibleVaultContent, containsVaultEnvelope, parseVaultBlock } from './vaultFileUtils';

/**
 * Resolves a live `TextEditor` for the given document URI, re-opening it if
 * necessary. Used instead of reusing a `TextEditor` reference captured before
 * showing a webview dialog: if that editor's tab was still a "preview" tab,
 * opening the dialog panel in the same view column replaces (closes) it,
 * which would make any edit against the stale reference throw.
 */
async function resolveEditorForEdit(sourceUri: vscode.Uri | undefined): Promise<vscode.TextEditor | undefined> {
  if (!sourceUri) {
    return undefined;
  }

  const existing = vscode.window.visibleTextEditors.find(
    (editor) => editor.document.uri.toString() === sourceUri.toString()
  );
  if (existing) {
    return existing;
  }

  const doc = await vscode.workspace.openTextDocument(sourceUri);
  return vscode.window.showTextDocument(doc, { preview: false });
}

/**
 * Applies `text` to the original source location: replacing `selection` if
 * one was captured, inserting at `cursorPosition` otherwise, or opening a new
 * untitled document if there was no source editor at all.
 */
async function applyResultToEditor(
  sourceUri: vscode.Uri | undefined,
  selection: vscode.Selection | undefined,
  cursorPosition: vscode.Position | undefined,
  text: string,
  language: string
): Promise<void> {
  const targetEditor = await resolveEditorForEdit(sourceUri);

  if (targetEditor && selection) {
    await targetEditor.edit((editBuilder) => {
      editBuilder.replace(selection, text);
    });
  } else if (targetEditor) {
    const insertPosition = cursorPosition ?? targetEditor.selection.active;
    await targetEditor.edit((editBuilder) => {
      editBuilder.insert(insertPosition, text);
    });
  } else {
    const doc = await vscode.workspace.openTextDocument({ content: text, language });
    await vscode.window.showTextDocument(doc, { preview: false });
  }
}

async function updateVaultFileContext(document?: vscode.TextDocument): Promise<void> {
  let isVaultFile = false;

  if (document?.uri.scheme === 'file') {
    try {
      const content = document.getText();
      isVaultFile = isAnsibleVaultContent(content);
    } catch {
      isVaultFile = false;
    }
  }

  await vscode.commands.executeCommand('setContext', 'ansibleVaultRt:isVaultFile', isVaultFile);
}

async function updateVaultSelectionContext(editor?: vscode.TextEditor): Promise<void> {
  let isVaultSelection = false;

  if (editor && !editor.selection.isEmpty) {
    try {
      isVaultSelection = containsVaultEnvelope(editor.document.getText(editor.selection));
    } catch {
      isVaultSelection = false;
    }
  }

  await vscode.commands.executeCommand('setContext', 'ansibleVaultRt:isVaultSelection', isVaultSelection);
}

export function activate(context: vscode.ExtensionContext) {
  const provider = new VaultFileSystemProvider();
  const passwordManager = new PasswordManager(context.secrets);

  // Register the in-memory FileSystemProvider
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider('ansible-vault-rt', provider, {
      isCaseSensitive: true,
      isReadonly: false
    })
  );

  // The active editor can churn transiently for reasons unrelated to the user
  // actually switching files: focus bouncing through a Quick Pick, the
  // Problems/Output panel briefly stealing focus (e.g. a linter reporting
  // diagnostics), a JSON/YAML schema picker navigating to the schema source,
  // or a language-mode change recreating the document. Reacting immediately
  // to each of these intermediate states causes the lock icon/menu entry to
  // flicker. Instead, debounce and always re-evaluate against whatever
  // `vscode.window.activeTextEditor` actually is once things settle, rather
  // than trusting the specific document passed by the triggering event.
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  const scheduleVaultFileContextRefresh = (delayMs = 120) => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined;
      void updateVaultFileContext(vscode.window.activeTextEditor?.document);
    }, delayMs);
  };

  context.subscriptions.push(
    { dispose: () => { if (debounceTimer) { clearTimeout(debounceTimer); } } },
    vscode.window.onDidChangeActiveTextEditor(() => scheduleVaultFileContextRefresh()),
    vscode.window.onDidChangeVisibleTextEditors(() => scheduleVaultFileContextRefresh()),
    vscode.workspace.onDidOpenTextDocument(() => scheduleVaultFileContextRefresh()),
    vscode.workspace.onDidChangeTextDocument((event) => {
      // Only recheck when the changed document is the active editor's document,
      // since `setContext` only affects the currently active editor's menus.
      if (event.document === vscode.window.activeTextEditor?.document) {
        scheduleVaultFileContextRefresh();
      }
    })
  );

  scheduleVaultFileContextRefresh(0);
  setTimeout(() => scheduleVaultFileContextRefresh(0), 500);

  // Tracks whether the current selection looks like an Ansible Vault "!vault"
  // block, so the "Decrypt String" context menu entry only shows up for
  // selections that are actually decryptable, rather than for any selection.
  let selectionDebounceTimer: ReturnType<typeof setTimeout> | undefined;

  const scheduleVaultSelectionContextRefresh = (delayMs = 50) => {
    if (selectionDebounceTimer) {
      clearTimeout(selectionDebounceTimer);
    }
    selectionDebounceTimer = setTimeout(() => {
      selectionDebounceTimer = undefined;
      void updateVaultSelectionContext(vscode.window.activeTextEditor);
    }, delayMs);
  };

  context.subscriptions.push(
    { dispose: () => { if (selectionDebounceTimer) { clearTimeout(selectionDebounceTimer); } } },
    vscode.window.onDidChangeTextEditorSelection((event) => {
      if (event.textEditor === vscode.window.activeTextEditor) {
        scheduleVaultSelectionContextRefresh();
      }
    }),
    vscode.window.onDidChangeActiveTextEditor(() => scheduleVaultSelectionContextRefresh())
  );

  scheduleVaultSelectionContextRefresh(0);

  // Register command to edit vault file
  const editVaultCommand = vscode.commands.registerCommand(
    'ansible-vault-rt.editVaultFile',
    async (uri?: vscode.Uri) => {
      // Determine the target URI
      let targetUri = uri;
      if (!targetUri) {
        // If not invoked from context menu, fallback to active editor
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
          targetUri = activeEditor.document.uri;
        }
      }

      if (!targetUri || targetUri.scheme !== 'file') {
        vscode.window.showWarningMessage('Please open or select a local file to edit as Ansible Vault.');
        return;
      }

      try {
        const fileContent = await fs.promises.readFile(targetUri.fsPath, 'utf8');
        const isVault = isAnsibleVaultContent(fileContent);
        const projectPath = passwordManager.getProjectPath(targetUri);
        const projectName = projectPath.split('/').pop() || projectPath;

        let password = await passwordManager.getSavedPassword(projectPath);
        let decryptedContent: string | undefined;

        if (isVault) {
          if (password) {
            try {
              const vault = new Vault({ password });
              decryptedContent = vault.decryptSync(fileContent);
            } catch (err: any) {
              // Saved password failed to decrypt the file
              const choice = await vscode.window.showErrorMessage(
                `Saved Ansible Vault password for project "${projectName}" is invalid.`,
                'Enter New Password',
                'Delete Saved Password'
              );

              if (choice === 'Delete Saved Password') {
                await passwordManager.deletePassword(projectPath);
                vscode.window.showInformationMessage(`Saved password for project "${projectName}" has been deleted.`);
                return;
              } else if (choice === 'Enter New Password') {
                password = undefined;
              } else {
                return; // User cancelled
              }
            }
          }

          let errorMessage: string | undefined = undefined;

          while (decryptedContent === undefined) {
            const result = await showPasswordDialog(
              'Enter Ansible Vault Password to decrypt file',
              projectName,
              errorMessage
            );

            if (!result) {
              return; // User cancelled modal
            }

            try {
              const vault = new Vault({ password: result.password });
              decryptedContent = vault.decryptSync(fileContent);
              password = result.password;

              if (result.remember) {
                await passwordManager.savePassword(projectPath, password);
              }
            } catch (err: any) {
              errorMessage = 'Invalid password or corrupted vault file. Please try again.';
            }
          }
        } else {
          // If it's a plaintext file, confirm if the user wants to encrypt it
          const confirm = await vscode.window.showInformationMessage(
            'This file is not encrypted. Do you want to encrypt it using Ansible Vault?',
            'Yes',
            'No'
          );
          if (confirm !== 'Yes') {
            return;
          }

          const result = await showPasswordDialog(
            'Enter Password to encrypt this file with Ansible Vault',
            projectName
          );

          if (!result) {
            return;
          }

          password = result.password;
          decryptedContent = fileContent;

          if (result.remember && password) {
            await passwordManager.savePassword(projectPath, password);
          }
        }

        if (decryptedContent === undefined || !password) {
          return;
        }

        // Create the virtual URI with our custom scheme
        const virtualUri = targetUri.with({ scheme: 'ansible-vault-rt' });

        // Register the document in our provider's memory
        const encoder = new TextEncoder();
        provider.registerDocument(virtualUri, encoder.encode(decryptedContent), password);

        // Open the document and show it in the editor
        const doc = await vscode.workspace.openTextDocument(virtualUri);
        await vscode.window.showTextDocument(doc, { preview: false });

      } catch (err: any) {
        vscode.window.showErrorMessage(`An error occurred: ${err.message}`);
      }
    }
  );

  context.subscriptions.push(editVaultCommand);

  // Register command to close decrypted vault and return to raw encrypted file
  const closeDecryptedFileCommand = vscode.commands.registerCommand(
    'ansible-vault-rt.closeDecryptedFile',
    async (uri?: vscode.Uri) => {
      let targetUri = uri || vscode.window.activeTextEditor?.document.uri;
      if (!targetUri || targetUri.scheme !== 'ansible-vault-rt') {
        return;
      }

      // If document is dirty, save it first (re-encrypts to disk)
      const activeEditor = vscode.window.activeTextEditor;
      if (activeEditor && activeEditor.document.uri.toString() === targetUri.toString()) {
        if (activeEditor.document.isDirty) {
          await activeEditor.document.save();
        }
      }

      // Close current virtual tab
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor');

      // Open original encrypted file on disk
      const originalUri = targetUri.with({ scheme: 'file' });
      const doc = await vscode.workspace.openTextDocument(originalUri);
      await vscode.window.showTextDocument(doc, { preview: false });
    }
  );

  context.subscriptions.push(closeDecryptedFileCommand);

  // Register command to clear saved vault password for current project
  const clearPasswordCommand = vscode.commands.registerCommand(
    'ansible-vault-rt.clearSavedPassword',
    async (uri?: vscode.Uri) => {
      let targetUri = uri || vscode.window.activeTextEditor?.document.uri;
      if (!targetUri && vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
        targetUri = vscode.workspace.workspaceFolders[0].uri;
      }

      if (!targetUri) {
        vscode.window.showWarningMessage('No open project or file found.');
        return;
      }

      const projectPath = passwordManager.getProjectPath(targetUri);
      const projectName = projectPath.split('/').pop() || projectPath;

      const savedPassword = await passwordManager.getSavedPassword(projectPath);
      if (!savedPassword) {
        vscode.window.showInformationMessage(`No saved Ansible Vault password found for project "${projectName}".`);
        return;
      }

      const confirm = await vscode.window.showWarningMessage(
        `Are you sure you want to delete the saved Vault password for project "${projectName}"?`,
        'Delete Password',
        'Cancel'
      );

      if (confirm === 'Delete Password') {
        await passwordManager.deletePassword(projectPath);
        vscode.window.showInformationMessage(`Saved Vault password for project "${projectName}" has been deleted.`);
      }
    }
  );

  context.subscriptions.push(clearPasswordCommand);

  // Register command to encrypt a plaintext file in place on disk
  const encryptFileCommand = vscode.commands.registerCommand(
    'ansible-vault-rt.encryptFile',
    async (uri?: vscode.Uri) => {
      let targetUri = uri;
      if (!targetUri) {
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
          targetUri = activeEditor.document.uri;
        }
      }

      if (!targetUri || targetUri.scheme !== 'file') {
        vscode.window.showWarningMessage('Please open or select a local file to encrypt.');
        return;
      }

      const fileName = targetUri.fsPath.split(/[\\/]/).pop() || targetUri.fsPath;

      try {
        const fileContent = await fs.promises.readFile(targetUri.fsPath, 'utf8');

        if (isAnsibleVaultContent(fileContent)) {
          vscode.window.showInformationMessage(`"${fileName}" is already encrypted with Ansible Vault.`);
          return;
        }

        const confirm = await vscode.window.showWarningMessage(
          `Do you really want to encrypt "${fileName}" with Ansible Vault?`,
          { modal: true },
          'Encrypt'
        );
        if (confirm !== 'Encrypt') {
          return;
        }

        const projectPath = passwordManager.getProjectPath(targetUri);
        const projectName = projectPath.split('/').pop() || projectPath;

        let password = await passwordManager.getSavedPassword(projectPath);
        if (password) {
          vscode.window.showInformationMessage(`Using saved Ansible Vault password for project "${projectName}".`);
        } else {
          const result = await showPasswordDialog(
            'Enter Password to encrypt this file with Ansible Vault',
            projectName
          );
          if (!result) {
            return; // User cancelled
          }

          password = result.password;
          if (result.remember) {
            await passwordManager.savePassword(projectPath, password);
          }
        }

        const vault = new Vault({ password });
        const encryptedContent = vault.encryptSync(fileContent);
        await fs.promises.writeFile(targetUri.fsPath, encryptedContent, 'utf8');

        vscode.window.showInformationMessage(`"${fileName}" has been encrypted with Ansible Vault.`);
      } catch (err: any) {
        vscode.window.showErrorMessage(`An error occurred while encrypting the file: ${err.message}`);
      }
    }
  );

  context.subscriptions.push(encryptFileCommand);

  // Register command to decrypt a vault file in place on disk
  const decryptFileCommand = vscode.commands.registerCommand(
    'ansible-vault-rt.decryptFile',
    async (uri?: vscode.Uri) => {
      let targetUri = uri;
      if (!targetUri) {
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
          targetUri = activeEditor.document.uri;
        }
      }

      if (!targetUri || targetUri.scheme !== 'file') {
        vscode.window.showWarningMessage('Please open or select a local file to decrypt.');
        return;
      }

      const fileName = targetUri.fsPath.split(/[\\/]/).pop() || targetUri.fsPath;

      try {
        const fileContent = await fs.promises.readFile(targetUri.fsPath, 'utf8');

        if (!isAnsibleVaultContent(fileContent)) {
          vscode.window.showInformationMessage(`"${fileName}" is not encrypted with Ansible Vault.`);
          return;
        }

        const confirm = await vscode.window.showWarningMessage(
          `Do you really want to decrypt "${fileName}"? This permanently removes Ansible Vault encryption from the file on disk.`,
          { modal: true },
          'Decrypt'
        );
        if (confirm !== 'Decrypt') {
          return;
        }

        const projectPath = passwordManager.getProjectPath(targetUri);
        const projectName = projectPath.split('/').pop() || projectPath;

        let password = await passwordManager.getSavedPassword(projectPath);
        let decryptedContent: string | undefined;

        if (password) {
          try {
            const vault = new Vault({ password });
            decryptedContent = vault.decryptSync(fileContent);
            vscode.window.showInformationMessage(`Using saved Ansible Vault password for project "${projectName}".`);
          } catch (err: any) {
            // Saved password failed to decrypt the file
            const choice = await vscode.window.showErrorMessage(
              `Saved Ansible Vault password for project "${projectName}" is invalid.`,
              'Enter New Password',
              'Delete Saved Password'
            );

            if (choice === 'Delete Saved Password') {
              await passwordManager.deletePassword(projectPath);
              vscode.window.showInformationMessage(`Saved password for project "${projectName}" has been deleted.`);
              return;
            } else if (choice === 'Enter New Password') {
              password = undefined;
            } else {
              return; // User cancelled
            }
          }
        }

        let errorMessage: string | undefined = undefined;

        while (decryptedContent === undefined) {
          const result = await showPasswordDialog(
            'Enter Ansible Vault Password to decrypt file',
            projectName,
            errorMessage
          );

          if (!result) {
            return; // User cancelled modal
          }

          try {
            const vault = new Vault({ password: result.password });
            decryptedContent = vault.decryptSync(fileContent);
            password = result.password;

            if (result.remember) {
              await passwordManager.savePassword(projectPath, password);
            }
          } catch (err: any) {
            errorMessage = 'Invalid password or corrupted vault file. Please try again.';
          }
        }

        await fs.promises.writeFile(targetUri.fsPath, decryptedContent, 'utf8');

        vscode.window.showInformationMessage(`"${fileName}" has been decrypted.`);
      } catch (err: any) {
        vscode.window.showErrorMessage(`An error occurred while decrypting the file: ${err.message}`);
      }
    }
  );

  context.subscriptions.push(decryptFileCommand);

  // Register command to change the password of a vault file in place on disk
  const rekeyFileCommand = vscode.commands.registerCommand(
    'ansible-vault-rt.rekeyFile',
    async (uri?: vscode.Uri) => {
      let targetUri = uri;
      if (!targetUri) {
        const activeEditor = vscode.window.activeTextEditor;
        if (activeEditor) {
          targetUri = activeEditor.document.uri;
        }
      }

      if (!targetUri || targetUri.scheme !== 'file') {
        vscode.window.showWarningMessage('Please open or select a local file to rekey.');
        return;
      }

      const fileName = targetUri.fsPath.split(/[\\/]/).pop() || targetUri.fsPath;

      try {
        const fileContent = await fs.promises.readFile(targetUri.fsPath, 'utf8');

        if (!isAnsibleVaultContent(fileContent)) {
          vscode.window.showInformationMessage(`"${fileName}" is not encrypted with Ansible Vault.`);
          return;
        }

        const confirm = await vscode.window.showWarningMessage(
          `Do you really want to change the password of "${fileName}"?`,
          { modal: true },
          'Rekey'
        );
        if (confirm !== 'Rekey') {
          return;
        }

        const projectPath = passwordManager.getProjectPath(targetUri);
        const projectName = projectPath.split('/').pop() || projectPath;

        // Resolve the current password and decrypt the file with it first
        let oldPassword = await passwordManager.getSavedPassword(projectPath);
        let decryptedContent: string | undefined;

        if (oldPassword) {
          try {
            const vault = new Vault({ password: oldPassword });
            decryptedContent = vault.decryptSync(fileContent);
            vscode.window.showInformationMessage(`Using saved Ansible Vault password for project "${projectName}".`);
          } catch (err: any) {
            // Saved password failed to decrypt the file
            const choice = await vscode.window.showErrorMessage(
              `Saved Ansible Vault password for project "${projectName}" is invalid.`,
              'Enter New Password',
              'Delete Saved Password'
            );

            if (choice === 'Delete Saved Password') {
              await passwordManager.deletePassword(projectPath);
              vscode.window.showInformationMessage(`Saved password for project "${projectName}" has been deleted.`);
              return;
            } else if (choice === 'Enter New Password') {
              oldPassword = undefined;
            } else {
              return; // User cancelled
            }
          }
        }

        let newPassword: string;
        let remember: boolean;

        if (decryptedContent !== undefined) {
          // The current password is already known (from the saved project
          // password), so only the new password needs to be collected.
          const newPasswordResult = await showPasswordDialog(
            'Enter New Password to rekey this file',
            projectName
          );

          if (!newPasswordResult) {
            return; // User cancelled modal
          }

          newPassword = newPasswordResult.password;
          remember = newPasswordResult.remember;
        } else {
          // The current password isn't known yet: collect both the current
          // and new password in a single dialog, validating the current
          // password in place (the panel stays open and shows an inline
          // error on a wrong password, rather than closing and reopening).
          const rekeyResult = await showRekeyPasswordDialog(projectName, async (candidatePassword) => {
            try {
              const vault = new Vault({ password: candidatePassword });
              decryptedContent = vault.decryptSync(fileContent);
              return { success: true };
            } catch {
              return { success: false, errorMessage: 'Invalid password or corrupted vault file. Please try again.' };
            }
          });

          if (!rekeyResult) {
            return; // User cancelled modal
          }

          newPassword = rekeyResult.newPassword;
          remember = rekeyResult.remember;
        }

        if (decryptedContent === undefined) {
          return;
        }

        const vault = new Vault({ password: newPassword });
        const encryptedContent = vault.encryptSync(decryptedContent);
        await fs.promises.writeFile(targetUri.fsPath, encryptedContent, 'utf8');

        if (remember) {
          await passwordManager.savePassword(projectPath, newPassword);
        }

        vscode.window.showInformationMessage(`"${fileName}" has been rekeyed with a new Ansible Vault password.`);
      } catch (err: any) {
        vscode.window.showErrorMessage(`An error occurred while rekeying the file: ${err.message}`);
      }
    }
  );

  context.subscriptions.push(rekeyFileCommand);

  // Register command to encrypt an arbitrary string into an Ansible Vault
  // "!vault" YAML block (the equivalent of `ansible-vault encrypt_string`).
  const encryptStringCommand = vscode.commands.registerCommand(
    'ansible-vault-rt.encryptString',
    async () => {
      try {
        const activeEditor = vscode.window.activeTextEditor;
        const sourceUri = activeEditor?.document.uri;
        const selection = activeEditor && !activeEditor.selection.isEmpty
          ? activeEditor.selection
          : undefined;
        const cursorPosition = activeEditor?.selection.active;
        const initialPlaintext = selection ? activeEditor!.document.getText(selection) : '';

        // Resolve a project context to look up/save a password, the same way
        // the file-based commands do: prefer the active editor's URI, falling
        // back to the first workspace folder.
        const contextUri = sourceUri
          ?? (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
            ? vscode.workspace.workspaceFolders[0].uri
            : undefined);

        const projectPath = contextUri ? passwordManager.getProjectPath(contextUri) : undefined;
        const projectName = projectPath ? (projectPath.split(/[\\/]/).pop() || projectPath) : 'this workspace';

        const savedPassword = projectPath ? await passwordManager.getSavedPassword(projectPath) : undefined;

        const result = await showEncryptStringDialog(projectName, initialPlaintext, !!savedPassword);
        if (!result) {
          return; // User cancelled
        }

        const password = savedPassword ?? result.password;
        if (!password) {
          return;
        }

        const vault = new Vault({ password });
        const encrypted = vault.encryptSync(result.plaintext);
        const indented = encrypted.split('\n').map((line) => `          ${line}`).join('\n');
        const variableName = result.variableName.trim();
        const block = variableName ? `${variableName}: !vault |\n${indented}` : `!vault |\n${indented}`;

        await applyResultToEditor(sourceUri, selection, cursorPosition, block, 'yaml');

        await vscode.env.clipboard.writeText(block);

        if (!savedPassword && result.remember && projectPath) {
          await passwordManager.savePassword(projectPath, password);
        }

        vscode.window.showInformationMessage('Encrypted string has been copied to the clipboard.');
      } catch (err: any) {
        vscode.window.showErrorMessage(`An error occurred while encrypting the string: ${err.message}`);
      }
    }
  );

  context.subscriptions.push(encryptStringCommand);

  // Register command to decrypt an Ansible Vault "!vault" YAML block back
  // into plaintext. There is no `ansible-vault decrypt_string` CLI
  // equivalent; this mirrors `encryptString` in reverse.
  const decryptStringCommand = vscode.commands.registerCommand(
    'ansible-vault-rt.decryptString',
    async () => {
      try {
        const activeEditor = vscode.window.activeTextEditor;
        const sourceUri = activeEditor?.document.uri;
        const selection = activeEditor && !activeEditor.selection.isEmpty
          ? activeEditor.selection
          : undefined;
        const cursorPosition = activeEditor?.selection.active;
        const initialVaultText = selection ? activeEditor!.document.getText(selection) : '';

        const contextUri = sourceUri
          ?? (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0
            ? vscode.workspace.workspaceFolders[0].uri
            : undefined);

        const projectPath = contextUri ? passwordManager.getProjectPath(contextUri) : undefined;
        const projectName = projectPath ? (projectPath.split(/[\\/]/).pop() || projectPath) : 'this workspace';

        const savedPassword = projectPath ? await passwordManager.getSavedPassword(projectPath) : undefined;

        const dialogResult = await showDecryptStringDialog(
          projectName,
          initialVaultText,
          !!savedPassword,
          async (vaultText, password) => {
            let parsed;
            try {
              parsed = parseVaultBlock(vaultText);
            } catch (parseErr: any) {
              return { success: false, errorMessage: parseErr.message };
            }

            const candidatePassword = password ?? savedPassword;
            if (!candidatePassword) {
              return { success: false, errorMessage: 'Password is required.', needsPassword: true };
            }

            try {
              const vault = new Vault({ password: candidatePassword });
              const plaintext = vault.decryptSync(parsed.envelope);
              return { success: true, plaintext, variableName: parsed.variableName };
            } catch {
              const errorMessage = password
                ? 'Invalid password or corrupted vault content. Please try again.'
                : `Saved Ansible Vault password for project "${projectName}" is invalid. Please enter a different password.`;
              return { success: false, errorMessage, needsPassword: true };
            }
          }
        );

        if (!dialogResult) {
          return; // User cancelled
        }

        const isMultiline = dialogResult.plaintext.includes('\n');
        let output: string;
        if (!dialogResult.variableName) {
          output = dialogResult.plaintext;
        } else if (isMultiline) {
          const indented = dialogResult.plaintext.split('\n').map((line) => `  ${line}`).join('\n');
          output = `${dialogResult.variableName}: |\n${indented}`;
        } else {
          output = `${dialogResult.variableName}: ${dialogResult.plaintext}`;
        }

        await applyResultToEditor(sourceUri, selection, cursorPosition, output, 'yaml');

        if (dialogResult.remember && dialogResult.password && projectPath) {
          await passwordManager.savePassword(projectPath, dialogResult.password);
        }

        vscode.window.showInformationMessage('String decrypted.');
      } catch (err: any) {
        vscode.window.showErrorMessage(`An error occurred while decrypting the string: ${err.message}`);
      }
    }
  );

  context.subscriptions.push(decryptStringCommand);

  // Unregister documents from memory when their editor tabs are closed
  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((doc) => {
      if (doc.uri.scheme === 'ansible-vault-rt') {
        provider.unregisterDocument(doc.uri);
      }
    })
  );
}

export function deactivate() {}

