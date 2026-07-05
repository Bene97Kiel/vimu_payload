import configPromise from '@payload-config'
import { getPayload } from 'payload'

import { geoNearIds, hydrateGeoMatches, parseLatLng, relationEqualsFilter } from '@/lib/geo'

export const GET = async (
  request: Request,
  { params }: { params: Promise<{ categoryId: string }> },
) => {
  const { categoryId } = await params
  const { searchParams } = new URL(request.url)
  const latLng = parseLatLng(searchParams)

  if (!latLng) {
    return Response.json({ error: 'Latitude and longitude are required' }, { status: 400 })
  }

  const payload = await getPayload({ config: configPromise })

  const matches = await geoNearIds({
    payload,
    collection: 'valuables',
    lat: latLng.lat,
    lng: latLng.lng,
    extraMatch: relationEqualsFilter('category', categoryId),
  })

  const docs = await hydrateGeoMatches({ payload, collection: 'valuables', matches })

  return Response.json(docs)
}
