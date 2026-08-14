// Scaffold smoke test: the dual-face plugin shape contract
// (host: webServer + sessionPersistence; client: slots + locale).
// Real behavior tests arrive with tickets 06/07.
import { describe, expect, it } from 'vitest'
import * as host from '../src/index'
import * as client from '../src/client/index'

describe('dual-face plugin shape', () => {
  it('host half declares webServer + sessionPersistence and exports apply', () => {
    expect(host.inject).toEqual(['webServer', 'sessionPersistence'])
    expect(typeof host.apply).toBe('function')
  })

  it('client half declares slots + locale and exports apply', () => {
    expect(client.inject).toEqual(['slots', 'locale'])
    expect(typeof client.apply).toBe('function')
  })
})
