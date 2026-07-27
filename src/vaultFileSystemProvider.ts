import * as vscode from 'vscode';
import * as fs from 'fs';
import { Vault } from 'ansible-vault';

export class VaultFileSystemProvider implements vscode.FileSystemProvider {
  // The password is kept as a Buffer rather than a string so it can be
  // explicitly zero-filled once the document is closed. JS strings are
  // immutable and can't be wiped, so they'd linger in memory until GC.
  private documents = new Map<string, { decryptedContent: Uint8Array; password: Buffer }>();

  private _onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this._onDidChangeFile.event;

  registerDocument(uri: vscode.Uri, decryptedContent: Uint8Array, password: string) {
    this.documents.set(uri.toString(), { decryptedContent, password: Buffer.from(password, 'utf8') });
    this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Created, uri }]);
  }

  unregisterDocument(uri: vscode.Uri) {
    const key = uri.toString();
    const doc = this.documents.get(key);
    if (doc) {
      doc.password.fill(0);
    }
    this.documents.delete(key);
    this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Deleted, uri }]);
  }

  hasDocument(uri: vscode.Uri): boolean {
    return this.documents.has(uri.toString());
  }

  watch(_uri: vscode.Uri, _options: { readonly recursive: boolean; readonly excludes: readonly string[] }): vscode.Disposable {
    return new vscode.Disposable(() => {});
  }

  stat(uri: vscode.Uri): vscode.FileStat {
    const doc = this.documents.get(uri.toString());
    if (!doc) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    return {
      type: vscode.FileType.File,
      ctime: 0,
      mtime: Date.now(),
      size: doc.decryptedContent.byteLength
    };
  }

  readDirectory(_uri: vscode.Uri): [string, vscode.FileType][] {
    return [];
  }

  createDirectory(_uri: vscode.Uri): void {
    throw vscode.FileSystemError.NoPermissions('Directories cannot be created in the virtual vault.');
  }

  readFile(uri: vscode.Uri): Uint8Array {
    const doc = this.documents.get(uri.toString());
    if (!doc) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    return doc.decryptedContent;
  }

  async writeFile(uri: vscode.Uri, content: Uint8Array, _options: { readonly create: boolean; readonly overwrite: boolean }): Promise<void> {
    const doc = this.documents.get(uri.toString());
    if (!doc) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }

    doc.decryptedContent = content;

    const textDecoder = new TextDecoder('utf-8');
    const decryptedText = textDecoder.decode(content);

    try {
      const vault = new Vault({ password: doc.password.toString('utf8') });
      const encryptedText = vault.encryptSync(decryptedText);

      const originalUri = uri.with({ scheme: 'file' });
      await fs.promises.writeFile(originalUri.fsPath, encryptedText, 'utf8');

      this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Changed, uri }]);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to encrypt and save file: ${err.message}`);
      throw err;
    }
  }

  delete(_uri: vscode.Uri, _options: { readonly recursive: boolean }): void {
    throw vscode.FileSystemError.NoPermissions('Files cannot be deleted from the virtual vault.');
  }

  rename(_oldUri: vscode.Uri, _newUri: vscode.Uri, _options: { readonly overwrite: boolean }): void {
    throw vscode.FileSystemError.NoPermissions('Files cannot be renamed in the virtual vault.');
  }
}
