import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const hasCode = (code) => (error) => error?.code === code

const reversibleCipher = (available = true) => ({
  isEncryptionAvailable: () => available,
  encryptString: (value) => Buffer.from([...value].reverse().join(''), 'utf8'),
  decryptString: (value) => [...value.toString('utf8')].reverse().join('')
})

test('refuses to persist a secret when operating-system encryption is unavailable', async (t) => {
  const { EncryptedSecretStore } = await import('../src/model/secret-store.ts')
  const sandbox = await mkdtemp(join(tmpdir(), 'open-novel-secret-unavailable-'))
  t.after(() => rm(sandbox, { recursive: true, force: true, maxRetries: 3 }))
  const store = new EncryptedSecretStore({ root: sandbox, cipher: reversibleCipher(false) })

  await assert.rejects(
    store.save('4cb23150-b7c2-4f56-bdc2-6ca863a86220', 'sk-must-not-land'),
    hasCode('MODEL_ENCRYPTION_UNAVAILABLE')
  )
  assert.deepEqual(await readdir(sandbox), [])
})

test('atomically stores ciphertext, restores the secret, and removes it', async (t) => {
  const { EncryptedSecretStore } = await import('../src/model/secret-store.ts')
  const sandbox = await mkdtemp(join(tmpdir(), 'open-novel-secret-roundtrip-'))
  t.after(() => rm(sandbox, { recursive: true, force: true, maxRetries: 3 }))
  const store = new EncryptedSecretStore({
    root: sandbox,
    cipher: reversibleCipher(),
    createTemporaryId: () => 'write-1'
  })
  const ref = '628f407c-1cac-49c8-be4b-eb0d5061ac60'
  const secret = 'sk-stage3-sentinel'

  await store.save(ref, secret)
  assert.equal(await store.read(ref), secret)
  const files = await readdir(sandbox)
  assert.deepEqual(files, [`${ref}.bin`])
  const encrypted = await readFile(join(sandbox, files[0]))
  assert.equal(encrypted.includes(Buffer.from(secret)), false)

  await store.remove(ref)
  assert.deepEqual(await readdir(sandbox), [])
  await assert.rejects(store.read(ref), hasCode('MODEL_SECRET_MISSING'))
})

test('keeps the previous ciphertext when atomic replacement fails', async (t) => {
  const { EncryptedSecretStore, nodeSecretStoreFileSystem } = await import('../src/model/secret-store.ts')
  const sandbox = await mkdtemp(join(tmpdir(), 'open-novel-secret-atomic-'))
  t.after(() => rm(sandbox, { recursive: true, force: true, maxRetries: 3 }))
  const ref = '9a04fda1-7c3f-4533-8bdd-2c9f492a7b0f'
  let renameCalls = 0
  const store = new EncryptedSecretStore({
    root: sandbox,
    cipher: reversibleCipher(),
    createTemporaryId: () => `write-${renameCalls + 1}`,
    fileSystem: {
      ...nodeSecretStoreFileSystem,
      rename: async (source, destination) => {
        renameCalls += 1
        if (renameCalls === 2) throw new Error('simulated replace failure')
        await nodeSecretStoreFileSystem.rename(source, destination)
      }
    }
  })

  await store.save(ref, 'sk-original')
  await assert.rejects(store.save(ref, 'sk-replacement'), hasCode('MODEL_OPERATION_FAILED'))
  assert.equal(await store.read(ref), 'sk-original')
  assert.deepEqual(await readdir(sandbox), [`${ref}.bin`])
})

test('allows HTTPS and explicit loopback HTTP but rejects credentialed or public insecure URLs', async () => {
  const { validateProviderBaseUrl } = await import('../src/model/model-validation.ts')

  assert.equal(validateProviderBaseUrl('https://api.deepseek.com/').href, 'https://api.deepseek.com/')
  assert.equal(validateProviderBaseUrl('http://127.0.0.1:11434/v1').href, 'http://127.0.0.1:11434/v1')
  assert.equal(validateProviderBaseUrl('http://[::1]:8080/v1').hostname, '[::1]')
  assert.throws(
    () => validateProviderBaseUrl('https://user:pass@api.deepseek.com'),
    hasCode('MODEL_INVALID_BASE_URL')
  )
  assert.throws(
    () => validateProviderBaseUrl('http://api.deepseek.com'),
    hasCode('MODEL_INVALID_BASE_URL')
  )
  assert.throws(
    () => validateProviderBaseUrl('file:///C:/Users/secret'),
    hasCode('MODEL_INVALID_BASE_URL')
  )
})

test('blocks insecure redirects before the second request and strips credentials across origins', async () => {
  const { createSecureRedirectFetch } = await import('../src/model/model-validation.ts')
  const insecureCalls = []
  let cancelledRedirectBodies = 0
  const insecureFetch = createSecureRedirectFetch(async (input, init) => {
    insecureCalls.push({ input: String(input), init })
    return new Response(new ReadableStream({
      cancel() { cancelledRedirectBodies += 1 }
    }), {
      status: 302,
      headers: { location: 'http://api.deepseek.com/v1/chat/completions' }
    })
  })

  await assert.rejects(
    insecureFetch('https://api.deepseek.com/chat/completions', {
      headers: { authorization: 'Bearer sk-never-forward' }
    }),
    hasCode('MODEL_INVALID_BASE_URL')
  )
  assert.equal(insecureCalls.length, 1)
  assert.equal(cancelledRedirectBodies, 1)

  const crossOriginCalls = []
  const crossOriginFetch = createSecureRedirectFetch(async (input, init) => {
    crossOriginCalls.push({ input: String(input), headers: new Headers(init?.headers) })
    return crossOriginCalls.length === 1
      ? new Response(new ReadableStream({
          cancel() { cancelledRedirectBodies += 1 }
        }), {
          status: 307,
          headers: { location: 'https://provider-edge.example/v1/chat/completions' }
        })
      : new Response('ok', { status: 200 })
  })
  const response = await crossOriginFetch('https://provider.example/v1/chat/completions', {
    headers: {
      authorization: 'Bearer sk-local-only',
      cookie: 'session=private',
      'x-api-key': 'anthropic-private',
      'x-goog-api-key': 'gemini-private',
      'x-request-id': 'safe-id'
    }
  })

  assert.equal(await response.text(), 'ok')
  assert.equal(crossOriginCalls.length, 2)
  assert.equal(crossOriginCalls[1].headers.get('authorization'), null)
  assert.equal(crossOriginCalls[1].headers.get('cookie'), null)
  assert.equal(crossOriginCalls[1].headers.get('x-api-key'), null)
  assert.equal(crossOriginCalls[1].headers.get('x-goog-api-key'), null)
  assert.equal(crossOriginCalls[1].headers.get('x-request-id'), 'safe-id')
  assert.equal(cancelledRedirectBodies, 2)
})
