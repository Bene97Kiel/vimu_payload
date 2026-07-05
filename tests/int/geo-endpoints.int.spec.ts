import { getPayload, Payload } from 'payload'
import config from '@/payload.config'
import type { Category, Provider, Site, User, Valuable } from '@/payload-types'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { GET as closestValuables } from '@/app/(payload)/api/geo/valuables/closest/route'
import { GET as randomValuables } from '@/app/(payload)/api/geo/valuables/random/route'
import { GET as byTagValuables } from '@/app/(payload)/api/geo/valuables/by-tag/[tag]/route'
import { GET as categoriesTop } from '@/app/(payload)/api/geo/categories/top/route'

let payload: Payload
let admin: User
let category: Category
let moreCategory: Category
let provider: Provider
let site: Site
let near: Valuable
let far: Valuable
let tagged: Valuable

const REFERENCE = { lat: 50, lng: 10 }

describe('custom geo endpoints', () => {
  beforeAll(async () => {
    const payloadConfig = await config
    payload = await getPayload({ config: payloadConfig })

    admin = await payload.create({
      collection: 'users',
      data: {
        email: 'geo-admin@test.local',
        password: 'test1234',
        surname: 'Admin',
        name: 'Test',
        role: 'admin',
      },
      disableVerificationEmail: true,
    })

    const media = await payload.create({
      collection: 'media',
      data: { alt: 'geo test icon' },
      file: { data: Buffer.from('test'), mimetype: 'text/plain', name: 'geo-icon.txt', size: 4 },
    })

    category = await payload.create({
      collection: 'categories',
      data: { name: 'Geo Test Category', icon: media.id },
    })
    moreCategory = await payload.create({
      collection: 'categories',
      data: { name: 'More', icon: media.id },
    })
    provider = await payload.create({
      collection: 'providers',
      data: { name: 'Geo Test Provider', user: admin.id },
    })
    site = await payload.create({
      collection: 'sites',
      data: {
        title: 'Geo Test Site',
        provider: provider.id,
        time: '9-5',
        location: [REFERENCE.lng, REFERENCE.lat],
        address: 'Test Address',
        isAvailable: true,
      },
    })

    const baseValuable = {
      site: site.id,
      publisher: admin.id,
      provider: provider.id,
      type: 'Artefact' as const,
      category: category.id,
      price: 100,
    }

    near = await payload.create({
      collection: 'valuables',
      data: {
        ...baseValuable,
        title: 'Near Valuable',
        data: { title: 'Near Valuable' },
        location: [REFERENCE.lng, REFERENCE.lat],
      },
    })
    far = await payload.create({
      collection: 'valuables',
      data: {
        ...baseValuable,
        title: 'Far Valuable',
        data: { title: 'Far Valuable' },
        location: [REFERENCE.lng + 10, REFERENCE.lat + 10],
      },
    })
    tagged = await payload.create({
      collection: 'valuables',
      data: {
        ...baseValuable,
        title: 'Tagged Valuable',
        data: { title: 'Tagged Valuable' },
        tags: [{ tag: 'special' }],
        location: [REFERENCE.lng + 5, REFERENCE.lat + 5],
      },
    })
  })

  afterAll(async () => {
    await payload.delete({
      collection: 'valuables',
      where: { id: { in: [near.id, far.id, tagged.id] } },
    })
    await payload.delete({ collection: 'sites', id: site.id })
    await payload.delete({ collection: 'providers', id: provider.id })
    await payload.delete({
      collection: 'categories',
      where: { id: { in: [category.id, moreCategory.id] } },
    })
    await payload.delete({ collection: 'users', id: admin.id })
  })

  it('returns valuables ascending by distance with a numeric distance field', async () => {
    const request = new Request(
      `http://localhost:3000/api/geo/valuables/closest?latitude=${REFERENCE.lat}&longitude=${REFERENCE.lng}`,
    )
    const response = await closestValuables(request)
    const docs = await response.json()

    const ids = docs.map((doc: { id: string }) => doc.id)
    expect(ids.indexOf(near.id)).toBeLessThan(ids.indexOf(far.id))
    for (const doc of docs) {
      expect(typeof doc.distance).toBe('number')
    }
  })

  it('filters valuables by tag', async () => {
    const request = new Request(
      `http://localhost:3000/api/geo/valuables/by-tag/special?latitude=${REFERENCE.lat}&longitude=${REFERENCE.lng}`,
    )
    const response = await byTagValuables(request, { params: Promise.resolve({ tag: 'special' }) })
    const docs = await response.json()

    expect(docs.map((doc: { id: string }) => doc.id)).toEqual([tagged.id])
  })

  it('returns a random sample of the requested size, each with a distance field', async () => {
    const request = new Request(
      `http://localhost:3000/api/geo/valuables/random?latitude=${REFERENCE.lat}&longitude=${REFERENCE.lng}&limit=2`,
    )
    const response = await randomValuables(request)
    const docs = await response.json()

    expect(docs).toHaveLength(2)
    for (const doc of docs) {
      expect(typeof doc.distance).toBe('number')
    }
  })

  it('returns 400 when latitude/longitude are missing', async () => {
    const request = new Request('http://localhost:3000/api/geo/valuables/closest')
    const response = await closestValuables(request)
    expect(response.status).toBe(400)
  })

  it('returns the top categories with a real "More" category appended last', async () => {
    const response = await categoriesTop()
    const docs = await response.json()

    expect(docs.length).toBeGreaterThan(0)
    expect(docs.length).toBeLessThanOrEqual(5)
    expect(docs[docs.length - 1].name).toBe('More')
    expect(docs.slice(0, -1).every((doc: { name: string }) => doc.name !== 'More')).toBe(true)
  })
})
