import { randomUUID } from 'node:crypto'
import {
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile
} from 'node:fs/promises'
import { join } from 'node:path'
import { ModelDomainError } from '../shared/model.ts'

export type SecretCipher = {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}

export type SecretStoreFileSystem = {
  mkdir(path: string, options: { recursive: true }): Promise<unknown>
  readFile(path: string): Promise<Buffer>
  rename(source: string, destination: string): Promise<void>
  unlink(path: string): Promise<void>
  writeFile(
    path: string,
    data: Buffer,
    options: { flag: 'wx' }
  ): Promise<void>
}

export const nodeSecretStoreFileSystem: SecretStoreFileSystem = {
  mkdir,
  readFile: (path) => readFile(path),
  rename,
  unlink,
  writeFile
}

const SECRET_REF_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const secretPath = (root: string, ref: string): string => {
  if (!SECRET_REF_PATTERN.test(ref)) {
    throw new ModelDomainError('MODEL_OPERATION_FAILED', 'Secret reference is invalid')
  }
  return join(root, `${ref}.bin`)
}

export class EncryptedSecretStore {
  readonly #root: string
  readonly #cipher: SecretCipher
  readonly #fileSystem: SecretStoreFileSystem
  readonly #createTemporaryId: () => string

  constructor(options: {
    root: string
    cipher: SecretCipher
    fileSystem?: SecretStoreFileSystem
    createTemporaryId?: () => string
  }) {
    this.#root = options.root
    this.#cipher = options.cipher
    this.#fileSystem = options.fileSystem ?? nodeSecretStoreFileSystem
    this.#createTemporaryId = options.createTemporaryId ?? randomUUID
  }

  async save(ref: string, secret: string): Promise<void> {
    if (!this.#cipher.isEncryptionAvailable()) {
      throw new ModelDomainError(
        'MODEL_ENCRYPTION_UNAVAILABLE',
        'Operating-system encryption is unavailable'
      )
    }
    if (typeof secret !== 'string' || secret.length === 0) {
      throw new ModelDomainError('MODEL_SECRET_MISSING', 'API key is required')
    }
    const destination = secretPath(this.#root, ref)
    const temporary = `${destination}.${this.#createTemporaryId()}.tmp`
    let temporaryWritten = false
    try {
      const encrypted = this.#cipher.encryptString(secret)
      await this.#fileSystem.mkdir(this.#root, { recursive: true })
      await this.#fileSystem.writeFile(temporary, encrypted, { flag: 'wx' })
      temporaryWritten = true
      await this.#fileSystem.rename(temporary, destination)
      temporaryWritten = false
    } catch (error) {
      if (temporaryWritten) {
        await this.#fileSystem.unlink(temporary).catch(() => undefined)
      }
      if (error instanceof ModelDomainError) throw error
      throw new ModelDomainError(
        'MODEL_OPERATION_FAILED',
        'Encrypted API key could not be saved',
        { cause: error }
      )
    }
  }

  async read(ref: string): Promise<string> {
    const path = secretPath(this.#root, ref)
    try {
      const encrypted = await this.#fileSystem.readFile(path)
      return this.#cipher.decryptString(encrypted)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new ModelDomainError('MODEL_SECRET_MISSING', 'API key is not configured')
      }
      if (error instanceof ModelDomainError) throw error
      throw new ModelDomainError(
        'MODEL_OPERATION_FAILED',
        'Encrypted API key could not be read',
        { cause: error }
      )
    }
  }

  async remove(ref: string): Promise<void> {
    const path = secretPath(this.#root, ref)
    await this.#fileSystem.unlink(path).catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new ModelDomainError(
          'MODEL_OPERATION_FAILED',
          'Encrypted API key could not be removed',
          { cause: error }
        )
      }
    })
  }
}
