declare module 'ansible-vault' {
  export class Vault {
    constructor(options: { password?: string });
    decryptSync(text: string): string;
    encryptSync(text: string): string;
    decrypt(text: string): Promise<string>;
    encrypt(text: string): Promise<string>;
  }
}
