import * as vscode from 'vscode';
import * as path from 'path';

export class PasswordManager {
  private secretStorage: vscode.SecretStorage;

  constructor(secretStorage: vscode.SecretStorage) {
    this.secretStorage = secretStorage;
  }

  /**
   * Generates a secret storage key for a project path.
   */
  private getStorageKey(projectPath: string): string {
    return `ansible-vault-rt.password:${projectPath}`;
  }

  /**
   * Returns the workspace project path for a given Uri, or falls back to the file's directory.
   */
  public getProjectPath(uri: vscode.Uri): string {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
    if (workspaceFolder) {
      return workspaceFolder.uri.fsPath;
    }
    // Fallback: directory containing the file. Uses the platform-native path
    // module so this works correctly on Windows (`\`) as well as POSIX (`/`).
    return path.dirname(uri.fsPath);
  }

  /**
   * Retrieves a saved password for a project path.
   */
  public async getSavedPassword(projectPath: string): Promise<string | undefined> {
    return await this.secretStorage.get(this.getStorageKey(projectPath));
  }

  /**
   * Saves a password for a project path.
   */
  public async savePassword(projectPath: string, password: string): Promise<void> {
    await this.secretStorage.store(this.getStorageKey(projectPath), password);
  }

  /**
   * Deletes a saved password for a project path.
   */
  public async deletePassword(projectPath: string): Promise<void> {
    await this.secretStorage.delete(this.getStorageKey(projectPath));
  }
}
