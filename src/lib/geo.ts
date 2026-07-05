import type { Payload } from 'payload'
import type { PipelineStage } from 'mongoose'

/**
 * Parses `latitude`/`longitude` (and optional `limit`) query params the same way
 * the old backend's geo endpoints required them. Returns `null` if lat/lng are
 * missing or non-numeric, so callers can respond with a 400.
 */
export function parseLatLng(searchParams: URLSearchParams): { lat: number; lng: number } | null {
  const latitude = searchParams.get('latitude')
  const longitude = searchParams.get('longitude')

  if (!latitude || !longitude) return null

  const lat = parseFloat(latitude)
  const lng = parseFloat(longitude)

  if (Number.isNaN(lat) || Number.isNaN(lng)) return null

  return { lat, lng }
}

export function parseLimit(searchParams: URLSearchParams, defaultValue: number): number {
  const raw = searchParams.get('limit')
  const parsed = raw ? parseInt(raw, 10) : NaN
  return Number.isNaN(parsed) ? defaultValue : parsed
}

export function haversineDistance(a: [number, number], b: [number, number]): number {
  const R = 6371e3 // Earth's radius in meters
  const lat1 = (a[1] * Math.PI) / 180
  const lat2 = (b[1] * Math.PI) / 180
  const deltaLat = ((b[1] - a[1]) * Math.PI) / 180
  const deltaLon = ((b[0] - a[0]) * Math.PI) / 180

  const h =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))

  return R * c
}

/**
 * Builds a $geoNear `query` filter matching a single-relationTo relationship field
 * (stored as a plain ObjectId) against a string ID, without needing to import
 * mongoose's `Types.ObjectId` into application code just to cast it.
 */
export function relationEqualsFilter(field: string, id: string): Record<string, unknown> {
  return { $expr: { $eq: [{ $toString: `$${field}` }, id] } }
}

export interface GeoMatch {
  _id: string
  distance: number
}

/**
 * Runs a $geoNear aggregation directly against the underlying mongoose model for a
 * geo-indexed collection, returning matched document IDs with computed distance
 * (in the order Mongo produced them). Payload's local API (`payload.find`) has no
 * equivalent of `$geoNear`'s `distanceField`, so callers hydrate these IDs via
 * `payload.find({ where: { id: { in: ids } } } )` afterwards to get populated,
 * access-controlled documents, then re-sort/re-attach distance in JS.
 */
export async function geoNearIds({
  payload,
  collection,
  lat,
  lng,
  extraMatch = {},
  sampleSize,
}: {
  payload: Payload
  collection: 'valuables' | 'sites'
  lat: number
  lng: number
  extraMatch?: Record<string, unknown>
  sampleSize?: number
}): Promise<GeoMatch[]> {
  const model = payload.db.collections[collection]

  const pipeline: PipelineStage[] = [
    {
      $geoNear: {
        near: { type: 'Point', coordinates: [lng, lat] },
        distanceField: 'distance',
        spherical: true,
        key: 'location',
        query: extraMatch,
      },
    },
  ]

  if (sampleSize !== undefined) {
    pipeline.push({ $sample: { size: sampleSize } })
  }

  pipeline.push({ $project: { _id: 1, distance: 1 } })

  return model.aggregate<GeoMatch>(pipeline)
}

/**
 * Hydrates geo-matched IDs into fully populated Payload documents (relations,
 * uploads, access control, hooks all run), preserving the aggregation's order
 * and re-attaching each document's computed `distance`.
 */
export async function hydrateGeoMatches({
  payload,
  collection,
  matches,
  depth = 2,
}: {
  payload: Payload
  collection: 'valuables' | 'sites'
  matches: GeoMatch[]
  depth?: number
}) {
  if (matches.length === 0) return []

  const ids = matches.map((match) => String(match._id))
  const distanceById = new Map(matches.map((match) => [String(match._id), match.distance]))

  const result = await payload.find({
    collection,
    where: { id: { in: ids } },
    depth,
    pagination: false,
  })

  const docsById = new Map(result.docs.map((doc) => [String(doc.id), doc]))

  return ids
    .map((id) => docsById.get(id))
    .filter((doc): doc is NonNullable<typeof doc> => Boolean(doc))
    .map((doc) => ({ ...doc, distance: distanceById.get(String(doc.id)) }))
}
