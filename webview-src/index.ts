import { invoke } from '@tauri-apps/api/tauri'

type BytesDto = string | number[]
export type ClientPath = string | Iterable<number> | ArrayLike<number> | ArrayBuffer
export type VaultPath = string | Iterable<number> | ArrayLike<number> | ArrayBuffer
export type RecordPath = string | Iterable<number> | ArrayLike<number> | ArrayBuffer
export type StoreKey = string | Iterable<number> | ArrayLike<number> | ArrayBuffer

function toBytesDto(v: ClientPath | VaultPath | RecordPath | StoreKey): string | number[] {
  if (typeof v === 'string') {
    return v
  }
  return Array.from(
    v instanceof ArrayBuffer
      ? new Uint8Array(v)
      : v
  )
}

export interface ConnectionLimits {
  maxPendingIncoming?: number
  maxPendingOutgoing?: number
  maxEstablishedIncoming?: number
  maxEstablishedOutgoing?: number
  maxEstablishedPerPeer?: number
  maxEstablishedTotal?: number
}

export interface PeerAddress {
  known: string[] // multiaddr
  use_relay_fallback: boolean
}

export interface AddressInfo {
  peers: Map<string, PeerAddress>
  relays: string[] // peers
}

export interface ClientAccess {
  useVaultDefault?: boolean
  useVaultExceptions?: Map<VaultPath, boolean>
  writeVaultDefault?: boolean
  writeVaultExceptions?: Map<VaultPath, boolean>
  cloneVaultDefault?: boolean
  cloneVaultExceptions?: Map<VaultPath, boolean>
  readStore?: boolean
  writeStore?: boolean
}

export interface Permissions {
  default?: ClientAccess
  exceptions?: Map<VaultPath, ClientAccess>
}

export interface NetworkConfig {
  requestTimeout?: Duration
  connectionTimeout?: Duration
  connectionsLimit?: ConnectionLimits
  enableMdns?: boolean
  enableRelay?: boolean
  addresses?: AddressInfo
  peerPermissions?: Map<string, Permissions>
  permissionsDefault?: Permissions
}

export interface Duration {
  millis: number
  nanos: number
}

export class Location {
  type: string
  payload: { [key: string]: any }

  constructor(type: string, payload: { [key: string]: any }) {
    this.type = type
    this.payload = payload
  }

  static generic(vault: VaultPath, record: RecordPath) {
    return new Location('Generic', {
      vault: toBytesDto(vault),
      record: toBytesDto(record)
    })
  }

  static counter(vault: VaultPath, counter: number) {
    return new Location('Counter', {
      vault: toBytesDto(vault),
      counter
    })
  }
}

class ProcedureExecutor {
  procedureArgs: { [k: string]: any }

  constructor(procedureArgs: { [k: string]: any }) {
    this.procedureArgs = procedureArgs
  }

  generateSLIP10Seed(outputLocation: Location, sizeBytes?: number): Promise<Uint8Array> {
    return invoke<number[]>(`plugin:stronghold|execute_procedure`, {
      ...this.procedureArgs,
      procedure: {
        type: 'SLIP10Generate',
        payload: {
          output: outputLocation,
          sizeBytes,
        }
      }
    }).then(n => Uint8Array.from(n))
  }

  deriveSLIP10(chain: number[], source: 'Seed' | 'Key', sourceLocation: Location, outputLocation: Location): Promise<Uint8Array> {
    return invoke<number[]>(`plugin:stronghold|execute_procedure`, {
      ...this.procedureArgs,
      procedure: {
        type: 'SLIP10Derive',
        payload: {
          chain,
          input: {
            type: source,
            payload: sourceLocation
          },
          output: outputLocation,
        }
      }
    }).then(n => Uint8Array.from(n))
  }

  recoverBIP39(mnemonic: string, outputLocation: Location, passphrase?: string): Promise<Uint8Array> {
    return invoke<number[]>(`plugin:stronghold|execute_procedure`, {
      ...this.procedureArgs,
      procedure: {
        type: 'BIP39Recover',
        payload: {
          mnemonic,
          passphrase,
          output: outputLocation,
        }
      }
    }).then(n => Uint8Array.from(n))
  }

  generateBIP39(outputLocation: Location, passphrase?: string): Promise<Uint8Array> {
    return invoke<number[]>(`plugin:stronghold|execute_procedure`, {
      ...this.procedureArgs,
      procedure: {
        type: 'BIP39Generate',
        payload: {
          output: outputLocation,
          passphrase,
        }
      }
    }).then(n => Uint8Array.from(n))
  }

  getEd25519PublicKey(privateKeyLocation: Location): Promise<Uint8Array> {
    return invoke<number[]>(`plugin:stronghold|execute_procedure`, {
      ...this.procedureArgs,
      procedure: {
        type: 'PublicKey',
        payload: {
          type: 'Ed25519',
          privateKey: privateKeyLocation
        }
      }
    }).then(n => Uint8Array.from(n))
  }

  signEd25519(privateKeyLocation: Location, msg: string): Promise<Uint8Array> {
    return invoke<number[]>(`plugin:stronghold|execute_procedure`, {
      ...this.procedureArgs,
      procedure: {
        type: 'Ed25519Sign',
        payload: {
          privateKey: privateKeyLocation,
          msg
        }
      }
    }).then(n => Uint8Array.from(n))
  }
}

export class Client {
  path: string
  name: BytesDto

  constructor(path: string, name: ClientPath) {
    this.path = path
    this.name = toBytesDto(name)
  }

  getVault(name: VaultPath): Vault {
    return new Vault(this.path, this.name, toBytesDto(name))
  }

  getStore(): Store {
    return new Store(this.path, this.name)
  }
}

export class Store {
  path: string
  client: BytesDto

  constructor(path: string, client: BytesDto) {
    this.path = path
    this.client = client
  }

  get(key: StoreKey): Promise<Uint8Array> {
    return invoke<number[]>('plugin:stronghold|get_store_record', {
      snapshotPath: this.path,
      client: this.client,
      key: toBytesDto(key)
    }).then(v => Uint8Array.from(v))
  }

  insert(key: StoreKey, value: number[], lifetime?: Duration): Promise<void> {
    return invoke('plugin:stronghold|save_store_record', {
      snapshotPath: this.path,
      client: this.client,
      key: toBytesDto(key),
      value,
      lifetime
    })
  }

  remove(key: StoreKey): Promise<Uint8Array | null> {
    return invoke<number[] | null>('plugin:stronghold|remove_store_record', {
      snapshotPath: this.path,
      client: this.client,
      key: toBytesDto(key)
    }).then(v => v ? Uint8Array.from(v) : null)
  }
}

export class Vault extends ProcedureExecutor {
  path: string
  client: BytesDto
  name: BytesDto

  constructor(path: string, client: ClientPath, name: VaultPath) {
    super({
      snapshotPath: path,
      client,
      vault: name,
    })
    this.path = path
    this.client = toBytesDto(client)
    this.name = toBytesDto(name)
  }

  insert(recordPath: RecordPath, secret: number[]): Promise<void> {
    return invoke('plugin:stronghold|save_secret', {
      snapshotPath: this.path,
      client: this.client,
      vault: this.name,
      recordPath: toBytesDto(recordPath),
      secret,
    })
  }

  remove(location: Location): Promise<void> {
    return invoke('plugin:stronghold|remove_secret', {
      snapshotPath: this.path,
      client: this.client,
      vault: this.name,
      location,
    })
  }
}

export class Stronghold {
  path: string

  constructor(path: string, password: string) {
    this.path = path
    this.reload(password)
  }

  private reload(password: string): Promise<void> {
    return invoke('plugin:stronghold|initialize', {
      snapshotPath: this.path,
      password
    })
  }

  unload(): Promise<void> {
    return invoke('plugin:stronghold|destroy', {
      snapshotPath: this.path
    })
  }

  loadClient(client: ClientPath): Promise<Client> {
    return invoke('plugin:stronghold|load_client', {
      snapshotPath: this.path,
      client: toBytesDto(client)
    }).then(() => new Client(this.path, client))
  }

  createClient(client: ClientPath): Promise<Client> {
    return invoke('plugin:stronghold|create_client', {
      snapshotPath: this.path,
      client: toBytesDto(client)
    }).then(() => new Client(this.path, client))
  }

  save(): Promise<void> {
    return invoke('plugin:stronghold|save', {
      snapshotPath: this.path
    })
  }
}
