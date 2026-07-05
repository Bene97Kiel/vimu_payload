import configPromise from '@payload-config'
import { getPayload } from 'payload'

import { geoNearIds, hydrateGeoMatches, parseLatLng } from '@/lib/geo'

export const GET = async (request: Request) => {
  const { searchParams } = new URL(request.url)
  const latLng = parseLatLng(searchParams)

  if (!latLng) {
    return Response.json({ error: 'Latitude and longitude are required' }, { status: 400 })
  }

  const payload = await getPayload({ config: configPromise })

  const matches = await geoNearIds({
    payload,
    collection: 'sites',
    lat: latLng.lat,
    lng: latLng.lng,
  })

  const docs = await hydrateGeoMatches({ payload, collection: 'sites', matches })

  return Response.json(docs)
}
