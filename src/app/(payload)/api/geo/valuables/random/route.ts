import configPromise from '@payload-config'
import { getPayload } from 'payload'

import { geoNearIds, hydrateGeoMatches, parseLatLng, parseLimit } from '@/lib/geo'

export const GET = async (request: Request) => {
  const { searchParams } = new URL(request.url)
  const latLng = parseLatLng(searchParams)

  if (!latLng) {
    return Response.json({ error: 'Latitude and longitude are required' }, { status: 400 })
  }

  const payload = await getPayload({ config: configPromise })
  const limit = parseLimit(searchParams, 15)

  const matches = await geoNearIds({
    payload,
    collection: 'valuables',
    lat: latLng.lat,
    lng: latLng.lng,
    sampleSize: limit,
  })

  const docs = await hydrateGeoMatches({ payload, collection: 'valuables', matches })

  return Response.json(docs)
}
