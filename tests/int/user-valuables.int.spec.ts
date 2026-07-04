import { getPayload, Payload } from 'payload'
import config from '@/payload.config'
import type { User, Valuable } from '@/payload-types'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let payload: Payload
let clientA: User
let clientB: User
let admin: User
let valuable: Valuable

describe('user-valuables ("collect a valuable") access control', () => {
  beforeAll(async () => {
    const payloadConfig = await config
    payload = await getPayload({ config: payloadConfig })

    clientA = await payload.create({
      collection: 'users',
      data: {
        email: 'collect-a@test.local',
        password: 'test1234',
        surname: 'A',
        name: 'Client',
        role: 'client',
      },
      disableVerificationEmail: true,
    })
    clientB = await payload.create({
      collection: 'users',
      data: {
        email: 'collect-b@test.local',
        password: 'test1234',
        surname: 'B',
        name: 'Client',
        role: 'client',
      },
      disableVerificationEmail: true,
    })
    admin = await payload.create({
      collection: 'users',
      data: {
        email: 'collect-admin@test.local',
        password: 'test1234',
        surname: 'Admin',
        name: 'Test',
        role: 'admin',
      },
      disableVerificationEmail: true,
    })

    const media = await payload.create({
      collection: 'media',
      data: { alt: 'test icon' },
      file: {
        data: Buffer.from('test'),
        mimetype: 'text/plain',
        name: 'test-icon.txt',
        size: 4,
      },
    })

    const category = await payload.create({
      collection: 'categories',
      data: { name: 'Test Category', icon: media.id },
    })
    const provider = await payload.create({
      collection: 'providers',
      data: { name: 'Test Provider', user: admin.id },
    })
    const site = await payload.create({
      collection: 'sites',
      data: {
        title: 'Test Site',
        provider: provider.id,
        time: '9-5',
        location: [10, 50],
        address: 'Test Address',
        isAvailable: true,
      },
    })
    valuable = await payload.create({
      collection: 'valuables',
      data: {
        site: site.id,
        publisher: admin.id,
        provider: provider.id,
        type: 'Artefact',
        title: 'Test Valuable',
        category: category.id,
        data: { title: 'Test Valuable' },
        location: [10, 50],
        price: 100,
      },
    })
  })

  afterAll(async () => {
    await payload.delete({ collection: 'valuables', id: valuable.id })
    await payload.delete({
      collection: 'users',
      where: { email: { in: [clientA.email, clientB.email, admin.email] } },
    })
  })

  it('creates a user-valuables record owned by the creator, ignoring a spoofed user id', async () => {
    const record = await payload.create({
      collection: 'user-valuables',
      data: {
        user: clientB.id, // spoofed — should be overwritten by the beforeChange hook
        valuable: valuable.id,
        price: 100,
        paymentMethod: 'Stripe',
        paymentStatus: 'Pending',
      },
      user: clientA,
      overrideAccess: false,
    })

    const recordUserId = typeof record.user === 'object' ? record.user.id : record.user
    expect(String(recordUserId)).toBe(String(clientA.id))

    await payload.delete({ collection: 'user-valuables', id: record.id })
  })

  it("lets a user read their own collected valuables but not another user's", async () => {
    const record = await payload.create({
      collection: 'user-valuables',
      data: {
        user: clientA.id,
        valuable: valuable.id,
        price: 100,
        paymentMethod: 'Stripe',
        paymentStatus: 'Pending',
      },
      user: clientA,
      overrideAccess: false,
    })

    const ownRead = await payload.find({
      collection: 'user-valuables',
      where: { id: { equals: record.id } },
      user: clientA,
      overrideAccess: false,
    })
    expect(ownRead.docs).toHaveLength(1)

    const otherRead = await payload.find({
      collection: 'user-valuables',
      where: { id: { equals: record.id } },
      user: clientB,
      overrideAccess: false,
    })
    expect(otherRead.docs).toHaveLength(0)

    const adminRead = await payload.find({
      collection: 'user-valuables',
      where: { id: { equals: record.id } },
      user: admin,
      overrideAccess: false,
    })
    expect(adminRead.docs).toHaveLength(1)

    await payload.delete({ collection: 'user-valuables', id: record.id })
  })
})
