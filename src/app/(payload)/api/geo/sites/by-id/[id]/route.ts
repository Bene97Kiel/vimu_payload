import configPromise from '@payload-config'
import { getPayload } from 'payload'

import { haversineDistance, parseLatLng } from '@/lib/geo'

export const GET = async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const { searchParams } = new URL(request.url)
  const latLng = parseLatLng(searchParams)

  if (!latLng) {
    return Response.json({ error: 'Latitude and longitude are required' }, { status: 400 })
  }

  const payload = await getPayload({ config: configPromise })

  try {
    const site = await payload.findByID({ collection: 'sites', id, depth: 2 })
    const distance = haversineDistance([latLng.lng, latLng.lat], site.location)

    return Response.json({ ...site, distance })
  } catch {
    return Response.json({ error: 'No site found for this id' }, { status: 404 })
  }
}
